'use strict'

let language = 'en'
const messages = require('../shared/backend-messages.json')
const reverse = new Map(Object.entries(messages).map(([tr, en]) => [en, tr]))
const patterns = [
  ['Uzak bağlantı için {protocol} ve doğrulanabilir TLS sertifikası gerekli.', 'Remote connections require {protocol} and a verifiable TLS certificate.'],
  ['TUN kapandı ({code})', 'The TUN helper closed ({code})'],
  ['Windows ağ koruması başarısız (kod: {code}). Yönetici iznini, BFE ve DNS Client servislerini kontrol edin.', 'Windows network protection failed (code: {code}). Check administrator permissions and the BFE and DNS Client services.'],
  ['xtp-tun-helper çıktı (kod: {code})', 'The TUN helper exited (code: {code})'],
  ['xtp-tun-helper bulunamadı: {file}', 'The TUN helper was not found: {file}'],
  ['xtp-tun-helper.exe bulunamadı: {file}', 'The Windows TUN helper was not found: {file}'],
  ['Linux yardımcı kaynağı hazır değil ({file}). Güncel Linux paketini yeniden indirin veya “bash scripts/build-client.sh” ile istemciyi derleyin.', 'The Linux helper source is missing ({file}). Download the current Linux package again or build the client with “bash scripts/build-client.sh”.'],
  ['Eksik sistem paketi: {package}. Paket yöneticisiyle kurup yeniden deneyin.', 'Missing system package: {package}. Install it with your package manager and retry.'],
]
const serverErrors = {
  'Invalid PIN': 'Kimlik doğrulama başarısız.',
  'Invalid PIN.': 'Kimlik doğrulama başarısız.',
  'Geçersiz PIN': 'Kimlik doğrulama başarısız.',
  'Geçersiz PIN.': 'Kimlik doğrulama başarısız.',
  'Invalid credentials': 'Kimlik doğrulama başarısız.',
  'Unauthorized': 'Kimlik doğrulama başarısız.',
  'Too many requests': 'Çok fazla istek gönderildi. Biraz bekleyip yeniden deneyin.',
}
messages['Çok fazla istek gönderildi. Biraz bekleyip yeniden deneyin.'] = 'Too many requests. Wait a moment and try again.'
reverse.set(messages['Çok fazla istek gönderildi. Biraz bekleyip yeniden deneyin.'], 'Çok fazla istek gönderildi. Biraz bekleyip yeniden deneyin.')

function setLanguage(value) {
  if (value !== 'en' && value !== 'tr') throw new Error(t('Geçersiz dil seçimi.'))
  language = value
  return language
}
function getLanguage() { return language }
function format(value, params) { return value.replace(/\{(\w+)\}/g, (match, key) => String(params[key] ?? match)) }
function t(key, params = {}) {
  const tr = reverse.get(key) || key
  const pattern = patterns.find(pair => pair[0] === tr || pair[1] === key)
  return format(language === 'tr' ? tr : messages[tr] || pattern?.[1] || key, params)
}
function matchPattern(template, value) {
  const names = []
  const escaped = template.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\\\{(\w+)\\\}/g, (_, name) => { names.push(name); return '(.+?)' })
  const match = new RegExp('^' + escaped + '$', 's').exec(value)
  return match ? Object.fromEntries(names.map((name, index) => [name, match[index + 1]])) : null
}
function translateError(value) {
  const message = typeof value === 'string' ? value : value?.message || String(value || '')
  if (!message) return message
  if (messages[message] || reverse.has(message)) return t(message)
  if (serverErrors[message]) return t(serverErrors[message])
  for (const [tr, en] of patterns) {
    const params = matchPattern(tr, message) || matchPattern(en, message)
    if (params) return format(language === 'tr' ? tr : en, params)
  }
  if (/CERT_|certificate|self[- ]signed|unable to verify|hostname\/ip does not match/i.test(message)) return t('TLS sertifikası doğrulanamadı. Sunucunun sertifikasını ve bilgisayar saatini kontrol edin.')
  if (/ENOTFOUND|EAI_AGAIN|ECONNREFUSED|ENETUNREACH|EHOSTUNREACH|ECONNRESET/.test(message)) return t('Sunucuya ulaşılamadı. Adresi ve internet bağlantınızı kontrol edin.')
  if (/ETIMEDOUT|AbortError|operation was aborted|request.*timed out/i.test(message)) return t('İstek zaman aşımına uğradı. Yeniden deneyin.')
  if (/ENOENT|EACCES|EPERM/.test(message)) return t('Dosyaya erişilemiyor. Dosyanın varlığını ve izinlerini kontrol edin.')
  if (/Unexpected token.*JSON|JSON at position|JSON input|not valid JSON/i.test(message)) return t('Geçersiz JSON yapılandırması.')
  if (message.trim().startsWith('Xantum protection: ')) {
    const detail = message.trim().slice('Xantum protection: '.length)
    const translated = translateError(detail)
    return translated === detail && !reverse.has(detail) ? t('Ağ koruması komutu tamamlanamadı. Sistem ağ servislerini ve yönetici izinlerini kontrol edin.') : translated
  }
  const windowsFailure = /^ERROR: Windows ag korumasi basarisiz \(kod: (\d+)\)/.exec(message.trim())
  if (windowsFailure) return t('Windows ağ koruması başarısız (kod: {code}). Yönetici iznini, BFE ve DNS Client servislerini kontrol edin.', { code: windowsFailure[1] })
  if (/^ERROR:/.test(message.trim())) return t('TUN yardımcısı hata bildirdi. Sistem ağ izinlerini ve yardımcı kurulumunu kontrol edin.')
  if (/Eksik sistem paketi: (nftables|iproute2)/.test(message)) return t('Eksik sistem paketi: {package}. Paket yöneticisiyle kurup yeniden deneyin.', { package: message.match(/Eksik sistem paketi: (nftables|iproute2)/)[1] })
  if (/Xantum yardimci kurulumu:/.test(message)) return t('Yardımcı kurulumu güvenlik doğrulamasını geçemedi. Güncel paketi yeniden indirip tekrar deneyin.')
  return message
}
function localizeResult(value) {
  if (!value || typeof value !== 'object') return value
  if (Array.isArray(value)) return value.map(localizeResult)
  return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key,
    ['error', 'setupError', 'message', 'profileLabel'].includes(key) && typeof entry === 'string' ? translateError(entry)
      : entry && typeof entry === 'object' ? localizeResult(entry) : entry]))
}
module.exports = { t, setLanguage, getLanguage, translateError, localizeResult }
