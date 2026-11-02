const fs = require('node:fs')
const path = require('node:path')
module.exports = async function validatePackage(context) {
  const appDir = context.packager.info.appDir
  const required = context.electronPlatformName === 'win32'
    ? ['xtp-tun-helper.exe', 'wintun.dll'] : ['xtp-tun-helper']
  for (const file of required) {
    if (!fs.existsSync(path.join(appDir, 'bin', file))) {
      throw new Error(`Paketleme durduruldu: bin/${file} eksik. docs/BUILDING.md adımlarını tamamlayın.`)
    }
  }
  if (context.electronPlatformName === 'linux') {
    for (const file of ['network-protection-linux.py', 'org.xantum.helpers.policy']) {
      if (!fs.existsSync(path.join(appDir, 'native', file))) throw new Error(`Paketleme durduruldu: native/${file} eksik.`)
    }
  }
}
