'use strict'
const path = require('node:path')
const { readProfile } = require('./connection-profile.cjs')
// Older NSIS cross-compilers parse directive names using the process locale.
// Turkish I/i casing can turn valid !addincludedir directives into errors.
// This changes only build-tool child processes, never the installed app's UI.
if (process.platform !== 'win32') { process.env.LANG = 'C.UTF-8'; process.env.LC_ALL = 'C.UTF-8' }
const config = structuredClone(require('../package.json').build)
const profile = process.env.XANTUM_CONNECTION_PROFILE
if (profile) {
  if (!path.isAbsolute(profile)) throw new Error('Hazır bağlantı dosyasının yolu mutlak olmalı.')
  readProfile(profile)
  config.extraResources = [...(config.extraResources || []), { from: profile, to: 'connection-profile.json' }]
  config.directories.output = 'dist-electron/private'
  config.artifactName = '${productName}-${version}-HazirBaglanti-${os}-${arch}.${ext}'
}
// Do not write a resolved configuration containing secrets into the repository.
module.exports = config
