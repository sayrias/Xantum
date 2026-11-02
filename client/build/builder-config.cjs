'use strict'
const path = require('node:path')
const { readProfile } = require('./connection-profile.cjs')
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
