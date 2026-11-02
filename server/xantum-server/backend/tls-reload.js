'use strict'
const tls = require('node:tls')

// Renewed certificates apply to future handshakes. Existing HTTPS/WebSocket
// connections keep their original TLS session and do not lose the VPN tunnel.
function createTlsReloader({ servers, readOptions, initialOptions, logger = console }) {
  let current = initialOptions
  return () => {
    let next
    try {
      next = readOptions()
      if (!next?.cert || !next?.key) throw new Error('TLS sertifikası ve özel anahtar gerekli.')
      tls.createSecureContext(next) // Validate the complete pair before updating either listener.
    } catch (error) {
      logger.error('[TLS] Sertifika yenilenemedi; mevcut bağlantılar korunuyor: ' + error.message)
      return false
    }
    const updated = []
    try {
      for (const server of servers) { server.setSecureContext(next); updated.push(server) }
      current = next
      logger.info('[TLS] API ve XTP sertifikaları bağlantılar kesilmeden yenilendi.')
      return true
    } catch (error) {
      for (const server of updated) {
        try { server.setSecureContext(current) } catch (failure) { logger.error('[TLS] Önceki sertifika geri yüklenemedi: ' + failure.message) }
      }
      logger.error('[TLS] Sertifika uygulanamadı: ' + error.message)
      return false
    }
  }
}
module.exports = { createTlsReloader }
