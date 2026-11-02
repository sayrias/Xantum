#!/usr/bin/env python3
"""Find an existing HTTP webroot without editing or reloading its web server.

A candidate is accepted only when a fresh file is served unchanged for the exact
certificate Host header. No redirects are followed. Only our random file and
empty directories created by this invocation are removed.
"""
import argparse
import http.client
import ipaddress
import json
import os
import secrets
import shlex
import signal
import subprocess
import sys
import time


def nginx_roots(config):
    lexer = shlex.shlex(config, posix=True, punctuation_chars="{};")
    lexer.whitespace_split = True
    lexer.commenters = "#"
    command = []
    roots = []
    try:
        for token in lexer:
            # shlex groups adjacent punctuation, e.g. ';}' in compact configs.
            if token and all(character in "{};" for character in token):
                for delimiter in token:
                    if delimiter == ";" and len(command) == 2 and command[0] == "root":
                        root = command[1]
                        if root.startswith("/") and "$" not in root:
                            roots.append(root)
                    command = []
            else:
                command.append(token)
    except ValueError:
        # A partial dump or unsupported quoting cannot authorize a webroot.
        return []
    return roots


def local_addresses(host):
    addresses = ["127.0.0.1"]
    try:
        result = subprocess.run(["ip", "-j", "-4", "address", "show"],
                                check=True, capture_output=True, text=True, timeout=5)
        for interface in json.loads(result.stdout):
            for item in interface.get("addr_info", []):
                address = item.get("local", "")
                if item.get("family") == "inet" and ipaddress.ip_address(address).version == 4:
                    addresses.append(address)
    except (OSError, ValueError, subprocess.SubprocessError):
        pass
    # Covers a public address behind provider NAT, where loopback cannot reach
    # the externally bound listener. Nothing is sent except an unguessable nonce.
    try:
        addresses.append(str(ipaddress.IPv4Address(host)))
    except ValueError:
        pass
    return list(dict.fromkeys(addresses))


def serves_nonce(address, port, host, name, nonce):
    connection = http.client.HTTPConnection(address, port, timeout=2)
    try:
        connection.request("GET", "/.well-known/acme-challenge/" + name,
                           headers={"Host": host, "Connection": "close"})
        response = connection.getresponse()
        return response.status == 200 and response.read(len(nonce) + 1) == nonce
    except (OSError, http.client.HTTPException):
        return False
    finally:
        connection.close()


def probe_webroot(root, host, addresses, port=80, deadline=None):
    if not os.path.isabs(root) or "\n" in root or "\r" in root:
        return False
    root = os.path.realpath(root)
    if root == "/" or not os.path.isdir(root):
        return False
    descriptors = []
    created = []
    name = "xantum-check-" + secrets.token_hex(20)
    nonce = secrets.token_hex(32).encode("ascii")
    file_created = False
    file_identity = None
    try:
        descriptor = os.open(root, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
        descriptors.append(descriptor)
        for component in (".well-known", "acme-challenge"):
            directory_created = False
            try:
                os.mkdir(component, 0o755, dir_fd=descriptor)
                info = os.stat(component, dir_fd=descriptor, follow_symlinks=False)
                directory_identity = (info.st_dev, info.st_ino)
                created.append((descriptor, component, directory_identity))
                directory_created = True
            except FileExistsError:
                pass
            descriptor = os.open(component, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW,
                                 dir_fd=descriptor)
            descriptors.append(descriptor)
            if directory_created:
                info = os.fstat(descriptor)
                if (info.st_dev, info.st_ino) != directory_identity:
                    return False
                # setup.sh uses umask 077; the web server must be able to read.
                os.fchmod(descriptor, 0o755)
        descriptor_file = os.open(name, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW,
                                  0o644, dir_fd=descriptor)
        file_created = True
        with os.fdopen(descriptor_file, "wb") as output:
            info = os.fstat(output.fileno())
            file_identity = (info.st_dev, info.st_ino)
            os.fchmod(output.fileno(), 0o644)
            output.write(nonce)
        for address in addresses:
            if deadline is not None and time.monotonic() >= deadline:
                break
            if serves_nonce(address, port, host, name, nonce):
                return True
        return False
    except OSError:
        return False
    finally:
        if file_created:
            try:
                info = os.stat(name, dir_fd=descriptors[-1], follow_symlinks=False)
                if (info.st_dev, info.st_ino) == file_identity:
                    os.unlink(name, dir_fd=descriptors[-1])
            except OSError:
                pass
        for parent, component, identity in reversed(created):
            try:
                info = os.stat(component, dir_fd=parent, follow_symlinks=False)
                if (info.st_dev, info.st_ino) == identity:
                    os.rmdir(component, dir_fd=parent)
            except OSError:
                pass
        for descriptor in reversed(descriptors):
            os.close(descriptor)


def find_webroot(host, explicit=None, port=80):
    deadline = time.monotonic() + 30
    if explicit:
        if not os.path.isabs(explicit) or "\n" in explicit or "\r" in explicit:
            return None
        candidates = [explicit]
    else:
        config = ""
        try:
            result = subprocess.run(["nginx", "-T"], capture_output=True,
                                    text=True, timeout=10)
            if result.returncode == 0:
                config = result.stdout
        except (OSError, subprocess.SubprocessError):
            pass
        candidates = nginx_roots(config) + ["/var/www/html", "/usr/share/nginx/html"]
    addresses = local_addresses(host)
    seen = set()
    for candidate in candidates:
        if len(seen) >= 32 or time.monotonic() >= deadline:
            break
        canonical = os.path.realpath(candidate)
        if canonical in seen:
            continue
        seen.add(canonical)
        if probe_webroot(canonical, host, addresses, port, deadline):
            return canonical
    return None


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--host", required=True)
    parser.add_argument("--webroot")
    parser.add_argument("--port", type=int, default=80)
    args = parser.parse_args()
    if not 1 <= args.port <= 65535:
        parser.error("port must be between 1 and 65535")
    def expired(_signum, _frame):
        raise TimeoutError("HTTP webroot discovery exceeded 30 seconds")
    signal.signal(signal.SIGALRM, expired)
    signal.alarm(30)
    try:
        result = find_webroot(args.host, args.webroot, args.port)
    except TimeoutError:
        result = None
    finally:
        signal.alarm(0)
    if result:
        print(result)
        return 0
    print("[TLS] TCP 80 mevcut bir HTTP servisine ait, fakat ACME dosyası mevcut site üzerinden doğrulanamadı. "
          "Hiçbir site veya servis değiştirilmedi. Nginx'te /.well-known/acme-challenge/ adresini "
          "statik dosyalara açın veya gelişmiş XANTUM_ACME_WEBROOT seçeneğiyle mevcut web kökünü belirtin; "
          "ardından kurulumu tekrarlayın. Sertifika yolu gerekmez.", file=sys.stderr)
    return 1


if __name__ == "__main__":
    sys.exit(main())
