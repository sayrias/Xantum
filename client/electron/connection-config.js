'use strict'
const { t, translateError, localizeResult } = require('./localization')
const net = require('node:net')
const { domainToASCII } = require('node:url')

function endpoint(value, protocol) {
  const url = new URL(value)
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)
  const insecure = protocol === 'https:' ? 'http:' : 'ws:'
  if (url.protocol !== protocol && !(local && url.protocol === insecure)) {
    throw new Error(t('Uzak bağlantı için {protocol} ve doğrulanabilir TLS sertifikası gerekli.', { protocol }))
  }
  if (url.username || url.password || url.hash || url.search || url.pathname !== '/') throw new Error(t('Sunucu adresi yalnızca protokol, alan adı ve port içermeli.'))
  return url.origin
}
function port(value, fallback) {
  if (value === undefined) return fallback
  if (!Number.isInteger(value) || value < 1 || value > 65535) throw new Error(t('Sunucu portu 1–65535 arasında bir sayı olmalı.'))
  return value
}
function connectionConfig(config) {
  if (!config || typeof config !== 'object' || Array.isArray(config)) throw new Error(t('Geçersiz bağlantı yapılandırması.'))
  const input = config.serverIp
  if (typeof input !== 'string' || !input.trim() || /[\\/:@?#;\s]/.test(input.trim())) throw new Error(t('Sunucu adresi gerekli.'))
  const host = domainToASCII(input.trim().replace(/\.$/, '').toLowerCase())
  if (!host || host.length > 253 || (!net.isIPv4(host) && !host.split('.').every(label => /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label)))) throw new Error(t('Geçerli bir alan adı veya IPv4 adresi girin.'))
  const pin = config.pin || config.inviteToken
  if (typeof pin !== 'string' || pin.length < 12 || pin.length > 256) throw new Error(t('Katılım anahtarı 12–256 karakter olmalı.'))
  const apiUrl = endpoint(config.apiUrl || `https://${host}:${port(config.apiPort, 51821)}`, 'https:')
  const xtpUrl = endpoint(config.xtpUrl || `wss://${host}:${port(config.xtpPort, 8443)}`, 'wss:')
  // A single server /32 exception cannot safely cover a different control host.
  if (new URL(apiUrl).hostname !== host || new URL(xtpUrl).hostname !== host) throw new Error(t('API ve XTP aynı sunucu alan adını kullanmalı.'))
  return { serverIp: host, pin, apiUrl, xtpUrl }
}
module.exports = { endpoint, connectionConfig }
