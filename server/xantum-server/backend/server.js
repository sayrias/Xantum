'use strict'
require('dotenv').config()
const fs = require('node:fs')
const http = require('node:http')
const https = require('node:https')
const express = require('express')
const { Server } = require('socket.io')
const XTPServer = require('./xtp-server')
const { createTlsReloader } = require('./tls-reload')
const { attachChat, validToken } = require('./chat')

const pin = process.env.VPN_PIN
if (!pin || pin.length < 12 || pin.length > 256) throw new Error('VPN_PIN 12–256 karakter olmalı; varsayılan anahtar kullanılmaz.')
const localOnly = process.env.XANTUM_LOCAL_TEST === '1'
const readTls = () => process.env.TLS_CERT && process.env.TLS_KEY ? {
  cert: fs.readFileSync(process.env.TLS_CERT), key: fs.readFileSync(process.env.TLS_KEY), minVersion: 'TLSv1.3',
} : null
const tls = readTls()
if (!tls && !localOnly) throw new Error('TLS_CERT ve TLS_KEY gerekli. HTTP yalnızca XANTUM_LOCAL_TEST=1 ile loopback üzerinde kullanılabilir.')
const host = localOnly ? '127.0.0.1' : '0.0.0.0'
const port = Number(process.env.API_PORT || 51821)
const xtpPort = Number(process.env.XTP_PORT || 8443)
const app = express()
app.disable('x-powered-by')
app.use(express.json({ limit: '4kb' }))
const server = tls ? https.createServer(tls, app) : http.createServer(app)
const io = new Server(server, { cors: { origin: '*' }, maxHttpBufferSize: 65536 })
attachChat(io, { pin })
// Global bound avoids an unbounded per-IP map. Deploy behind a rate-limited ingress.
let registrationStart = Date.now(), registrations = 0
app.post('/register', (req, res) => {
  if (Date.now() - registrationStart >= 60000) { registrationStart = Date.now(); registrations = 0 }
  if (++registrations > 60) return res.status(429).json({ error: 'Çok fazla kayıt isteği. Bir dakika sonra deneyin.' })
  if (!validToken(req.body?.pin, pin)) return res.status(403).json({ error: 'Geçersiz katılım anahtarı.' })
  res.set('Cache-Control', 'no-store').json({ success: true, config: {
    protocol: 'xtp', version: '1.0.0', serverIp: process.env.VPN_IP,
    xtpPort, iceServers: JSON.parse(process.env.ICE_SERVERS || '[]'),
  } })
})
let terminating = false
function failServer(error) {
  if (terminating) return
  terminating = true
  // A failed API bind must also release the persistent TUN and owned NAT rules.
  // Keep the failure status even if all handles close before the fallback timer.
  process.exitCode = 1
  console.error(error.message)
  xtp.stop(); io.close(); server.close()
  setTimeout(() => process.exit(1), 100).unref()
}
const xtp = new XTPServer({ wsPort: xtpPort, pin, tls, host,
  onFatal: failServer,
  helperPath: process.env.TUN_HELPER || '/usr/local/bin/xantum/xtp-tun-helper' })
server.on('error', failServer)
app.get('/health', (_, res) => res.json({ status: xtp.tunReady && xtp.transportServer?.listening ? 'ok' : 'degraded', protocol: 'xtp', version: '1.0.0', clients: xtp.clients.size }))
app.use((error, req, res, next) => res.status(400).json({ error: 'Geçersiz istek.' }))
xtp.start()
if (tls) process.on('SIGHUP', createTlsReloader({ servers: [server, xtp.transportServer], readOptions: readTls, initialOptions: tls }))
server.listen(port, host, () => console.log(`Xantum API: ${host}:${port}, TLS: ${Boolean(tls)}`))
for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => {
  if (terminating) return
  terminating = true
  xtp.stop(); io.close(); server.close(() => process.exit(0))
  setTimeout(() => process.exit(1), 5000).unref()
})
