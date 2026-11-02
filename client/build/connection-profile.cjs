'use strict'
const { connectionConfig } = require('../electron/connection-config')
const { readConfig, writeConfig } = require('../electron/config-store')

function validateProfile(value) {
  if (value?.version !== 1) throw new Error('Hazır bağlantı profili sürümü geçersiz.')
  const config = connectionConfig(value)
  return { version: 1, label: 'Hazır bağlantı', ...config }
}
function readProfile(file) { return validateProfile(readConfig(file)) }
module.exports = { validateProfile, readProfile }

if (require.main === module) {
  // Secrets enter only via stdin, never a shell argument or environment value.
  let input = Buffer.alloc(0)
  process.stdin.on('data', part => {
    input = Buffer.concat([input, part])
    if (input.length > 4096) { process.stderr.write('Profil girdisi çok büyük.\n'); process.exit(1) }
  })
  process.stdin.on('end', () => {
    try {
      const [serverIp, pin, api, xtp] = input.toString('utf8').split('\0')
      const config = validateProfile({ version: 1, serverIp, pin, apiPort: Number(api || 51821), xtpPort: Number(xtp || 8443) })
      if (!process.argv[2]) throw new Error('Geçici profil dosyası belirtilmedi.')
      writeConfig(process.argv[2], config)
    } catch (error) { process.stderr.write(`Hazır bağlantı hazırlanamadı: ${error.message}\n`); process.exitCode = 1 }
  })
}
