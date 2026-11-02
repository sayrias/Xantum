'use strict'
const { t, translateError, localizeResult } = require('./localization')
const fs = require('node:fs')
const path = require('node:path')
const { readConfig, writeConfig } = require('./config-store')
const { connectionConfig } = require('./connection-config')

function profileLabel(value) {
  return typeof value === 'string' && value.trim() && value.length <= 64 && !/[\x00-\x1f\x7f]/.test(value)
    ? t(value.trim()) : t('Hazır bağlantı')
}
function read(file) {
  try { return readConfig(file) }
  catch { throw new Error(t('Bağlantı profili okunamadı. Ayarlar → Sunucun bölümünden bilgileri yeniden kaydedin.')) }
}
function exists(file) {
  try { fs.lstatSync(file); return true }
  catch (error) { if (error.code === 'ENOENT') return false; throw error }
}

// A bundled profile is a first-use default. Existing user settings always win,
// including on an upgrade to a package prepared for a different server.
function loadServerProfile({ userData, isPackaged, resourcesPath, developmentProfile, legacyFile }) {
  const saved = path.join(userData, 'server.json')
  if (exists(saved)) {
    const value = read(saved)
    return { config: connectionConfig(value), source: value.profileOrigin === 'bundled' ? 'bundled' : 'manual', label: profileLabel(value.profileLabel) }
  }
  const bundled = isPackaged
    ? (resourcesPath ? path.join(resourcesPath, 'connection-profile.json') : null)
    : developmentProfile
  if (bundled && exists(bundled)) {
    const value = read(bundled)
    if (value.version !== 1) throw new Error(t('Hazır bağlantı profilinin sürümü desteklenmiyor. Sunucunu Ayarlar bölümünden kaydedebilirsin.'))
    const config = connectionConfig(value), label = profileLabel(value.label)
    writeConfig(saved, { ...config, profileOrigin: 'bundled', profileLabel: label })
    return { config, source: 'bundled', label }
  }
  if (!isPackaged && legacyFile && exists(legacyFile)) return { config: connectionConfig(read(legacyFile)), source: 'manual', label: '' }
  throw new Error(t('Önce Ayarlar → Sunucun bölümünden sunucu adresini ve katılım anahtarını kaydedin.'))
}
module.exports = { loadServerProfile }
