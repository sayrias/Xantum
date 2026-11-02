#!/usr/bin/python3 -I
"""Narrow, root-owned Xantum nftables broker. No shell and no caller-selected files.

Rules live independently of the Electron/TUN processes. Only release removes them.
The journal is root-writable, public-readable and contains no credentials. /run and
the nft table are both volatile across reboot; this is not a boot-time firewall.
"""
import fcntl
import hashlib
import ipaddress
import json
import os
import pathlib
import pwd
import subprocess
import sys
import tempfile

STATE_DIR = pathlib.Path('/run/xantum-protection')
TABLE = 'xantum_v1'
NFT = '/usr/sbin/nft' if pathlib.Path('/usr/sbin/nft').exists() else '/usr/bin/nft'
IP = '/usr/sbin/ip' if pathlib.Path('/usr/sbin/ip').exists() else '/usr/bin/ip'
DNS = '1.1.1.1'


def dhcp_uids():
    # DHCP renewals keep the underlying physical lease alive. Only root and
    # well-known system DHCP accounts may send this narrowly scoped traffic.
    values = {0}
    for name in ('systemd-network', 'dhcpcd', '_dhcpcd', 'dhcp', '_dhcp'):
        try:
            user = pwd.getpwnam(name)
            if 0 <= user.pw_uid < 1000:
                values.add(user.pw_uid)
        except KeyError:
            pass
    return ', '.join(str(value) for value in sorted(values))


def command(args, text=None):
    return subprocess.run(args, input=text, text=True, check=True, capture_output=True,
                          env={'PATH': '/usr/sbin:/usr/bin:/sbin:/bin', 'LC_ALL': 'C'}, timeout=15).stdout


def owner_uid():
    raw = os.environ.get('PKEXEC_UID') or os.environ.get('SUDO_UID') or str(os.getuid())
    if not raw.isdecimal():
        raise RuntimeError('Invalid invoking user')
    return int(raw)


def load():
    file = STATE_DIR / 'state.json'
    if not file.exists():
        return None
    stat = file.lstat()
    if file.is_symlink() or stat.st_uid != 0 or stat.st_mode & 0o022:
        raise RuntimeError('Invalid state ownership')
    state = json.loads(file.read_text())
    if state.get('version') != 1 or state.get('owner') != owner_uid():
        raise RuntimeError('Protection belongs to another user or version')
    return state


def save(state):
    fd, name = tempfile.mkstemp(prefix='state-', dir=STATE_DIR)
    try:
        with os.fdopen(fd, 'w') as stream:
            json.dump(state, stream); stream.flush(); os.fsync(stream.fileno())
        os.chmod(name, 0o644)
        os.replace(name, STATE_DIR / 'state.json')
    finally:
        if os.path.exists(name):
            os.unlink(name)


def table():
    # Distinguish an absent table from a broken nft/kernel/privilege setup.
    tables = json.loads(command([NFT, '-j', 'list', 'tables']))
    exists = any(item.get('table', {}).get('family') == 'inet' and
                 item.get('table', {}).get('name') == TABLE for item in tables['nftables'])
    return json.loads(command([NFT, '-j', 'list', 'table', 'inet', TABLE])) if exists else None


def owned(actual, state):
    if actual is None:
        return False
    marker = f"Xantum v1 owner={state['owner']} token={state['token']}"
    if not any(item.get('table', {}).get('comment') == marker for item in actual['nftables']):
        raise RuntimeError('Existing nft table is not owned by this Xantum session')
    return True


def fingerprint(actual):
    def normalize(value):
        if isinstance(value, dict):
            return {key: normalize(val) for key, val in value.items() if key not in ('handle', 'index')}
        if isinstance(value, list):
            return [normalize(val) for val in value]
        return value
    stable = [normalize(item) for item in actual['nftables'] if 'metainfo' not in item]
    return hashlib.sha256(json.dumps(stable, sort_keys=True).encode()).hexdigest()


def rules(state):
    ports = ', '.join(str(port) for port in state['ports'])
    marker = f"Xantum v1 owner={state['owner']} token={state['token']}"
    lines = [f'table inet {TABLE} {{', f'comment "{marker}"',
             # Destination NAT reroutes only after LOCAL_OUT finishes. Enforce
             # the actual egress in POSTROUTING, after that route lookup and SNAT.
             'chain output { type filter hook postrouting priority 200; policy drop;',
             'oifname "lo" accept',
             f'meta nfproto ipv4 meta skuid {{ {dhcp_uids()} }} udp sport 68 udp dport 67 accept',
             f'ip daddr {state["endpoint"]} meta skuid {state["owner"]} tcp dport {{ {ports} }} accept']
    if state.get('assignedIp'):
        lines.append('meta nfproto ipv4 oifname "xtp0" accept')
    # No established/related exemption: pre-existing physical flows must also stop.
    # IPv6 has no external permit. Other LAN/multicast traffic has no permit.
    lines.extend(['}', 'chain dns { type nat hook output priority -100; policy accept;',
                  f'ip daddr != 127.0.0.0/8 meta l4proto {{ tcp, udp }} th dport 53 dnat ip to {DNS}', '}'])
    if state.get('assignedIp'):
        # A system resolver may bind to a physical source address. Rewrite that
        # source as well; the XTP server rejects sources outside the assigned IP.
        lines.extend(['chain dns_source { type nat hook postrouting priority 100; policy accept;',
                      f'oifname "xtp0" ip daddr {DNS} meta l4proto {{ tcp, udp }} th dport 53 snat ip to {state["assignedIp"]}', '}'])
    lines.append('}')
    return '\n'.join(lines) + '\n'


def replace(state, actual):
    batch = (f'delete table inet {TABLE}\n' if owned(actual, state) else '') + rules(state)
    command([NFT, '-c', '-f', '-'], batch)
    # Journal first: a crash after commit still has an owner/recovery record.
    state['phase'] = 'updating'; save(state)
    command([NFT, '-f', '-'], batch)
    current = table()
    if not owned(current, state):
        raise RuntimeError('nft rules did not commit')
    state['fingerprint'] = fingerprint(current); state['phase'] = 'active'; save(state)
    return status(state, current)


def status(state, actual):
    active = state is not None and owned(actual, state)
    verified = active and state.get('phase') == 'active' and state.get('fingerprint') == fingerprint(actual)
    tunnel_present = False
    if active and state.get('assignedIp'):
        links = json.loads(command([IP, '-j', 'address', 'show']))
        tunnel_present = any(link.get('ifname') == 'xtp0' and info.get('local') == state['assignedIp']
                             for link in links for info in link.get('addr_info', []))
    result = {'active': active, 'blocked': active and not tunnel_present, 'verified': verified}
    if active:
        result.update(endpoint=state['endpoint'], ports=state['ports'])
    return result


def remove_host_route(state):
    route = state.get('hostRoute') if state else None
    if not route:
        return
    rows = json.loads(command([IP, '-j', 'route', 'show', f'{state["endpoint"]}/32', 'proto', '186']))
    for row in rows:
        if (row.get('dst', '').split('/')[0] == state['endpoint'] and row.get('dev') == route['dev'] and
                row.get('gateway', '') == route.get('gateway', '') and row.get('metric') == 1):
            args = [IP, 'route', 'del', f'{state["endpoint"]}/32']
            if route.get('gateway'):
                args.extend(['via', route['gateway']])
            command(args + ['dev', route['dev'], 'metric', '1', 'proto', '186'])


def capture_host_route(endpoint):
    row = json.loads(command([IP, '-j', 'route', 'get', endpoint]))[0]
    if row.get('dev') in ('lo', 'xtp0') or not row.get('dev'):
        raise RuntimeError('Server needs a physical IPv4 route')
    # Never claim a pre-existing route as part of the recovery journal. The TUN
    # helper uses this reserved protocol+metric, and release removes that exact
    # record after a forced termination. An existing record has another owner.
    existing = json.loads(command([IP, '-j', 'route', 'show', f'{endpoint}/32', 'proto', '186']))
    if any(route.get('dst', '').split('/')[0] == endpoint and route.get('metric') == 1 for route in existing):
        raise RuntimeError('Server route identity is already in use')
    return {'dev': row['dev'], 'gateway': row.get('gateway', '')}


def dispatch(operation, args):
    state, actual = load(), table()
    if actual is not None and state is None:
        raise RuntimeError('Unowned nft table exists; refusing to change it')
    if operation == 'status' and not args:
        return status(state, actual)
    if operation == 'release' and not args:
        remove_host_route(state)
        if state and owned(actual, state):
            command([NFT, 'delete', 'table', 'inet', TABLE])
        if table() is not None:
            raise RuntimeError('Protection table still exists')
        (STATE_DIR / 'state.json').unlink(missing_ok=True)
        return {'active': False, 'blocked': False, 'verified': True}
    if operation == 'arm' and len(args) == 2:
        address = str(ipaddress.IPv4Address(args[0]))
        ports = sorted(set(int(port) for port in args[1].split(',')))
        if not 1 <= len(ports) <= 4 or any(not 1 <= port <= 65535 for port in ports):
            raise RuntimeError('Invalid server ports')
        if state and actual:
            owned(actual, state)
            if state['endpoint'] != address or state['ports'] != ports:
                raise RuntimeError('Release previous protection before changing server')
        remove_host_route(state)
        host_route = capture_host_route(address)
        if state is None or actual is None:
            state = {'version': 1, 'owner': owner_uid(), 'token': os.urandom(16).hex(),
                     'endpoint': address, 'ports': ports}
        state['hostRoute'] = host_route
        state.pop('assignedIp', None)
        return replace(state, actual)
    if operation in ('bind', 'block') and state and actual:
        owned(actual, state)
        if operation == 'bind' and len(args) == 1:
            assigned = ipaddress.IPv4Address(args[0])
            if assigned not in ipaddress.IPv4Network('10.8.0.0/24') or int(str(assigned).split('.')[-1]) not in range(2, 255):
                raise RuntimeError('Invalid tunnel address')
            links = json.loads(command([IP, '-j', 'address', 'show', 'dev', 'xtp0']))
            if not any(info.get('local') == str(assigned) for link in links for info in link.get('addr_info', [])):
                raise RuntimeError('Owned tunnel address is not present')
            state['assignedIp'] = str(assigned)
            return replace(state, actual)
        if operation == 'block' and not args:
            state.pop('assignedIp', None)
            return replace(state, actual)
    raise RuntimeError('Invalid operation or no active protection')


def main():
    if os.geteuid() != 0:
        raise RuntimeError('Network helper requires administrator authorization')
    os.umask(0o022)
    STATE_DIR.mkdir(mode=0o755, exist_ok=True)
    stat = STATE_DIR.lstat()
    if STATE_DIR.is_symlink() or stat.st_uid != 0 or stat.st_mode & 0o022:
        raise RuntimeError('Invalid state directory ownership')
    lock_fd = os.open(STATE_DIR / 'lock', os.O_CREAT | os.O_RDWR | os.O_NOFOLLOW, 0o600)
    with os.fdopen(lock_fd, 'w') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX)
        result = dispatch(sys.argv[1] if len(sys.argv) > 1 else '', sys.argv[2:])
    print(json.dumps(result))


if __name__ == '__main__':
    try:
        main()
    except Exception as error:
        print(f'Xantum protection: {error}', file=sys.stderr)
        sys.exit(1)
