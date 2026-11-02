'use strict'

const fs = require('node:fs')
const path = require('node:path')
const crypto = require('node:crypto')
const { execFile } = require('node:child_process')

const HELPER_FILES = Object.freeze([
  { name: 'xtp-tun-helper', group: 'bin', limit: 8 * 1024 * 1024 },
  { name: 'network-protection-linux.py', group: 'helpers', limit: 256 * 1024 },
  { name: 'org.xantum.helpers.policy', group: 'helpers', limit: 64 * 1024 },
])

// Only the system interpreter is elevated. It receives this fixed bootstrap as
// an argument, never an executable script from a writable checkout/AppImage.
// Payloads are copied as data and are not executed during installation.
const INSTALLER_PYTHON = String.raw`
import hashlib, json, os, pathlib, re, shutil, stat, sys, tempfile

TARGETS = {
    'xtp-tun-helper': ('/usr/local/libexec/xantum', 0o755, 8 * 1024 * 1024),
    'network-protection-linux.py': ('/usr/local/libexec/xantum', 0o755, 256 * 1024),
    'org.xantum.helpers.policy': ('/usr/share/polkit-1/actions', 0o644, 64 * 1024),
}


def trusted_directory(directory, create=False):
    current = pathlib.Path('/')
    for part in pathlib.Path(directory).parts[1:]:
        current = current / part
        try:
            entry = current.lstat()
        except FileNotFoundError:
            if not create:
                raise
            current.mkdir(mode=0o755)
            entry = current.lstat()
        if not stat.S_ISDIR(entry.st_mode) or entry.st_uid != 0 or entry.st_mode & 0o022:
            raise RuntimeError('Hedef klasor root sahipli, sembolik bagsiz ve yazmaya kapali olmali: ' + str(current))


def read_payload(directory_fd, name, owner, digest):
    limit = TARGETS[name][2]
    fd = os.open(name, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK, dir_fd=directory_fd)
    with os.fdopen(fd, 'rb') as stream:
        entry = os.fstat(stream.fileno())
        if not stat.S_ISREG(entry.st_mode) or entry.st_uid != owner or entry.st_nlink != 1 or entry.st_mode & 0o077:
            raise RuntimeError('Guvenli olmayan yardimci kaynagi: ' + name)
        data = stream.read(limit + 1)
        if not data or len(data) > limit or hashlib.sha256(data).hexdigest() != digest:
            raise RuntimeError('Yardimci butunluk dogrulamasi basarisiz: ' + name)
        return data


def install_payload(directory, name, mode, data):
    target = pathlib.Path(directory) / name
    try:
        entry = target.lstat()
        if not stat.S_ISREG(entry.st_mode) or entry.st_uid != 0 or entry.st_mode & 0o022:
            raise RuntimeError('Guvenli olmayan mevcut yardimci: ' + name)
    except FileNotFoundError:
        pass
    fd, temporary = tempfile.mkstemp(prefix='.xantum-install-', dir=directory)
    try:
        with os.fdopen(fd, 'wb') as stream:
            stream.write(data)
            stream.flush()
            os.fsync(stream.fileno())
            os.fchmod(stream.fileno(), mode)
            os.fchown(stream.fileno(), 0, 0)
        os.replace(temporary, target)
    finally:
        try:
            os.unlink(temporary)
        except FileNotFoundError:
            pass


def main():
    if os.geteuid() != 0 or len(sys.argv) != 3:
        raise RuntimeError('Yardimci kurulumu yonetici onayi gerektiriyor.')
    caller = os.environ.get('PKEXEC_UID', '')
    if not caller.isdecimal() or int(caller) == 0:
        raise RuntimeError('Gecerli masaustu kullanicisi gerekli; uygulamayi sudo ile acmayin.')
    staging = pathlib.Path(sys.argv[1])
    if staging.parent != pathlib.Path('/tmp') or not re.fullmatch(r'xantum-helpers-[A-Za-z0-9]+', staging.name):
        raise RuntimeError('Gecersiz kurulum kaynak klasoru.')
    manifest = json.loads(sys.argv[2])
    if not isinstance(manifest, dict) or set(manifest) != set(TARGETS) or any(not isinstance(value, str) or not re.fullmatch(r'[a-f0-9]{64}', value) for value in manifest.values()):
        raise RuntimeError('Gecersiz yardimci bildirimi.')
    directory_fd = os.open(staging, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
    try:
        entry = os.fstat(directory_fd)
        if entry.st_uid != int(caller) or entry.st_mode & 0o077:
            raise RuntimeError('Guvenli olmayan kurulum kaynak klasoru.')
        payloads = {name: read_payload(directory_fd, name, int(caller), manifest[name]) for name in TARGETS}
    finally:
        os.close(directory_fd)
    for command in ('nft', 'ip'):
        if not shutil.which(command, path='/usr/sbin:/usr/bin:/sbin:/bin'):
            raise RuntimeError('Eksik sistem paketi: ' + ('nftables' if command == 'nft' else 'iproute2') + '. Paket yoneticisiyle kurup yeniden deneyin.')
    for directory in dict.fromkeys(value[0] for value in TARGETS.values()):
        trusted_directory(directory, create=True)
    for name, (directory, mode, _) in TARGETS.items():
        install_payload(directory, name, mode, payloads[name])
    print(json.dumps({'installed': True}))


if __name__ == '__main__':
    try:
        main()
    except Exception as error:
        print('Xantum yardimci kurulumu: ' + str(error), file=sys.stderr)
        sys.exit(1)
`

function runInstaller(file, args) {
  return new Promise((resolve, reject) => execFile(file, args,
    { timeout: 120000, maxBuffer: 128 * 1024, windowsHide: true }, (error, stdout, stderr) => {
      if (error) {
        if (error.code === 'ENOENT') error.message = 'Yönetici onayı aracı bulunamadı. Dağıtımınızın pkexec/polkit paketini kurup yeniden deneyin.'
        else if (error.code === 126 || error.code === 127) error.message = 'Yönetici onayı veya sistem Python 3 başlatılamadı. Python 3 ve polkit kurulumunu kontrol edip yeniden deneyin.'
        else error.message = String(stderr || error.message).trim()
        reject(error); return
      }
      try { resolve(JSON.parse(stdout)) } catch { reject(new Error('Yardımcı kurulumu doğrulanabilir bir yanıt vermedi.')) }
    }))
}

async function installLinuxHelpers({ resourcesPath, run = runInstaller, files = fs } = {}) {
  const sourceRoot = resourcesPath || path.resolve(__dirname, '..')
  const payloads = HELPER_FILES.map(entry => {
    const source = path.join(sourceRoot, entry.group === 'helpers' && !resourcesPath ? 'native' : entry.group, entry.name)
    let fd
    try {
      fd = files.openSync(source, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK)
      const info = files.fstatSync(fd)
      if (!info.isFile() || info.size <= 0 || info.size > entry.limit) throw new Error('Geçersiz yardımcı dosyası.')
      const data = files.readFileSync(fd)
      if (data.length !== info.size) throw new Error('Yardımcı dosyası okuma sırasında değişti.')
      return { ...entry, data }
    } catch (error) {
      throw new Error(`Linux yardımcı kaynağı hazır değil (${entry.name}). Güncel Linux paketini yeniden indirin veya “bash scripts/build-client.sh” ile istemciyi derleyin.`, { cause: error })
    } finally { if (fd !== undefined) files.closeSync(fd) }
  })
  const staging = files.mkdtempSync('/tmp/xantum-helpers-')
  files.chmodSync(staging, 0o700)
  try {
    const manifest = {}
    for (const entry of payloads) {
      files.writeFileSync(path.join(staging, entry.name), entry.data, { flag: 'wx', mode: 0o600 })
      manifest[entry.name] = crypto.createHash('sha256').update(entry.data).digest('hex')
    }
    const result = await run('/usr/bin/pkexec', ['/usr/bin/python3', '-I', '-c', INSTALLER_PYTHON, staging, JSON.stringify(manifest)])
    if (result?.installed !== true) throw new Error('Linux yardımcı kurulumu tamamlanmadı.')
    return { installed: true }
  } finally { files.rmSync(staging, { recursive: true, force: true }) }
}

module.exports = { installLinuxHelpers, INSTALLER_PYTHON, HELPER_FILES }
