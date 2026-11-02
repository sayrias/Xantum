/**
 * xtp-server.js — Xantum Tünel Protokolü (XTP) Sunucu Motoru
 *
 * Özellikler:
 *  - Linux TUN cihazı (xtp0, 10.8.0.1/24)
 *  - WebSocket üzerinden şifreli tünel (AES-256-GCM)
 *  - ECDH anahtar değişimi (prime256v1)
 *  - Otomatik IP havuzu (10.8.0.2 - 10.8.0.254)
 *  - NAT yönlendirme (internet erişimi)
 */

'use strict'

const { WebSocketServer } = require('ws')
const { execSync, spawn }  = require('child_process')
const crypto               = require('crypto')
const path                 = require('path')
const fs                   = require('fs')
const { validToken } = require('./chat')

const SUBNET     = '10.8.0'
const SERVER_IP  = `${SUBNET}.1`
const IFACE_NAME = 'xtp0'
const CIPHER     = 'aes-256-gcm'
const MTU        = 1380

/* ---- Yardımcı: varsayılan ağ arayüzünü bul ---- */
function detectEgressIface() {
  try {
    return execSync("ip route get 8.8.8.8 2>/dev/null | grep -oP 'dev \\K\\S+' | head -1")
      .toString().trim()
  } catch {
    return 'eth0'
  }
}

/* ---- Şifreleme ---- */
function encrypt(key, plaintext) {
  const iv       = crypto.randomBytes(12)
  const cipher   = crypto.createCipheriv(CIPHER, key, iv)
  const body     = Buffer.concat([cipher.update(plaintext), cipher.final()])
  const tag      = cipher.getAuthTag()
  return Buffer.concat([iv, tag, body])  // 12 + 16 + N
}

function decrypt(key, data) {
  const iv         = data.slice(0, 12)
  const tag        = data.slice(12, 28)
  const ciphertext = data.slice(28)
  const decipher   = crypto.createDecipheriv(CIPHER, key, iv)
  decipher.setAuthTag(tag)
  return Buffer.concat([decipher.update(ciphertext), decipher.final()])
}

/* ================================================================
 * XTPServer
 * ================================================================ */
class XTPServer {
  constructor(options = {}) {
    this.wsPort  = options.wsPort  ?? 8443
    this.pin     = options.pin || process.env.VPN_PIN
    if (!this.pin || this.pin.length < 12) throw new Error('Güçlü bir VPN_PIN gerekli')
    this.tunReady = false
    this.stopping = false
    this.ownedRules = []
    this.ownsInterface = false
    this.onFatal = options.onFatal || (() => {})
    this.tls = options.tls
    this.host = options.host || '127.0.0.1'
    this.clientsByIp = new Map()
    this.clients = new Map()   // id → { ip, ws, sharedKey }

    // IP havuzu: 10.8.0.2 … 10.8.0.254
    this.ipPool = []
    for (let i = 2; i <= 254; i++) this.ipPool.push(`${SUBNET}.${i}`)

    this.tunProcess = null
    this.tunReadBuf = Buffer.alloc(0)
    this.wss        = null
    this.egressIface = null
    this.helperPath  = options.helperPath || path.join(__dirname, '..', 'xtp-tun-helper')
  }

  /* ---- Başlat ---- */
  start() {
    this.egressIface = detectEgressIface()
    if (!/^[a-zA-Z0-9_.:-]{1,15}$/.test(this.egressIface)) throw new Error('Geçersiz çıkış arayüzü')
    console.log(`[XTP] Çıkış arayüzü: ${this.egressIface}`)
    try { this._setupTun(); this._startWS() }
    catch (error) { this.stop(); throw error }
    console.log(`[XTP] Sunucu başlatıldı. WebSocket portu: ${this.wsPort}`)
  }

  /* ---- Durdur ---- */
  stop() {
    if (this.stopping) return
    this.stopping = true
    this.tunReady = false
    clearInterval(this.heartbeat)
    if (this.wss) { for (const ws of this.wss.clients) ws.terminate(); this.wss.close() }
    this.transportServer?.close()
    if (this.tunProcess) { try { this.tunProcess.kill('SIGTERM') } catch {} }
    this._teardownTun()
  }

  /* ==============================================================
   * TUN Cihazı
   * ============================================================== */
  _setupTun() {
    if (!fs.existsSync(this.helperPath)) throw new Error('XTP TUN helper bulunamadı')
    // An existing interface may belong to another VPN instance. Do not delete it.
    let exists = false
    try { execSync(`ip link show dev ${IFACE_NAME}`, { stdio: 'ignore' }); exists = true } catch {}
    if (exists) throw new Error('xtp0 arayüzü zaten kullanımda; otomatik silinmedi.')

    execSync(`ip tuntap add dev ${IFACE_NAME} mode tun`)
    this.ownsInterface = true
    execSync(`ip addr add ${SERVER_IP}/24 dev ${IFACE_NAME}`)
    execSync(`ip link set ${IFACE_NAME} mtu ${MTU} up`)

    // NAT
    const ef = this.egressIface
    const nat = `iptables -t nat -C POSTROUTING -s ${SUBNET}.0/24 -o ${ef} -j MASQUERADE 2>/dev/null`
    try { execSync(nat) } catch {
      execSync(`iptables -t nat -A POSTROUTING -s ${SUBNET}.0/24 -o ${ef} -j MASQUERADE`)
      this.ownedRules.push(`iptables -t nat -D POSTROUTING -s ${SUBNET}.0/24 -o ${ef} -j MASQUERADE`)
    }
    const fwdIn  = `iptables -C FORWARD -i ${IFACE_NAME} -j ACCEPT 2>/dev/null`
    const fwdOut = `iptables -C FORWARD -o ${IFACE_NAME} -j ACCEPT 2>/dev/null`
    try { execSync(fwdIn) } catch {
      execSync(`iptables -A FORWARD -i ${IFACE_NAME} -j ACCEPT`)
      this.ownedRules.push(`iptables -D FORWARD -i ${IFACE_NAME} -j ACCEPT`)
    }
    try { execSync(fwdOut) } catch {
      execSync(`iptables -A FORWARD -o ${IFACE_NAME} -j ACCEPT`)
      this.ownedRules.push(`iptables -D FORWARD -o ${IFACE_NAME} -j ACCEPT`)
    }

    // TUN yardımcısını başlat
    if (!fs.existsSync(this.helperPath)) {
      throw new Error(`xtp-tun-helper bulunamadı: ${this.helperPath}\nSetup.sh ile derlenmeli!`)
    }

    this.tunProcess = spawn(this.helperPath, [IFACE_NAME], { stdio: ['pipe', 'pipe', 'pipe'] })

    this.tunProcess.stderr.on('data', (d) => {
      const s = d.toString().trim()
      if (s.includes('TUN_READY')) { this.tunReady = true; console.log(`[XTP] TUN hazır: ${IFACE_NAME} (${SERVER_IP}/24)`) }
      else console.error('[XTP TUN]', s)
    })

    this.tunProcess.stdout.on('data', (chunk) => {
      this.tunReadBuf = Buffer.concat([this.tunReadBuf, chunk])
      this._drainTunBuf()
    })

    this.tunProcess.on('error', error => { console.error('[XTP TUN]', error.message); this.stop(); this.onFatal(error) })
    this.tunProcess.stdin.on('error', () => {})
    this.tunProcess.on('exit', () => {
      this.tunProcess = null
      this.tunReady = false
      if (!this.stopping) { this.stop(); this.onFatal(new Error('TUN kapandı')) }
    })
  }

  _drainTunBuf() {
    while (this.tunReadBuf.length >= 2) {
      const pktLen = this.tunReadBuf.readUInt16BE(0)
      if (this.tunReadBuf.length < 2 + pktLen) break
      const pkt = this.tunReadBuf.slice(2, 2 + pktLen)
      this.tunReadBuf = this.tunReadBuf.slice(2 + pktLen)
      this._routeFromTun(pkt)
    }
  }

  _writeTun(pkt) {
    if (!this.tunProcess || !this.tunProcess.stdin.writable || this.tunProcess.stdin.writableLength > 1024 * 1024) return
    const hdr = Buffer.allocUnsafe(2)
    hdr.writeUInt16BE(pkt.length, 0)
    this.tunProcess.stdin.write(Buffer.concat([hdr, pkt]))
  }

  /* IPv4 hedef IP'sine göre paketi doğru istemciye yönlendir */
  _routeFromTun(pkt) {
    if (pkt.length < 20) return
    if ((pkt[0] >> 4) !== 4) return  // Sadece IPv4

    const dstIp = `${pkt[16]}.${pkt[17]}.${pkt[18]}.${pkt[19]}`

    const client = this.clientsByIp.get(dstIp)
    if (client?.ws.readyState === 1 && client.ws.bufferedAmount < 1024 * 1024) {
      try { client.ws.send(encrypt(client.sharedKey, pkt)) } catch {}
    }
    // Bilinmeyen hedef — düşür
  }

  _teardownTun() {
    for (const command of this.ownedRules.reverse()) {
      try { execSync(command, { stdio: 'ignore' }) } catch {}
    }
    this.ownedRules = []
    if (this.ownsInterface) {
      try { execSync(`ip link del ${IFACE_NAME}`, { stdio: 'ignore' }) } catch {}
      this.ownsInterface = false
    }
  }

  /* ==============================================================
   * WebSocket Sunucusu
   * ============================================================== */
  _startWS() {
    this.transportServer = this.tls ? require('https').createServer(this.tls) : require('http').createServer()
    this.wss = new WebSocketServer({ server: this.transportServer, perMessageDeflate: false, maxPayload: 65564 })
    this.transportServer.on('error', error => {
      console.error('[XTP]', error.message)
      this.stop()
      this.onFatal(error)
    })
    this.transportServer.listen(this.wsPort, this.host)
    this.heartbeat = setInterval(() => {
      for (const ws of this.wss.clients) {
        if (ws.alive === false) { ws.terminate(); continue }
        ws.alive = false; ws.ping()
      }
    }, 15000)
    this.heartbeat.unref()

    this.wss.on('connection', (ws, req) => {
      if (!this.tunReady) { ws.close(1013, 'TUN hazır değil'); return }
      ws.alive = true
      ws.on('pong', () => { ws.alive = true })
      const cid      = crypto.randomBytes(6).toString('hex')
      const remoteIp = req.socket.remoteAddress
      console.log(`[XTP] Bağlantı: ${cid} (${remoteIp})`)

      /* ECDH: sunucu tarafı anahtar çifti */
      const ecdh = crypto.createECDH('prime256v1')
      ecdh.generateKeys()

      const assignedIp = this.ipPool.shift()
      if (!assignedIp) {
        ws.close(1013, 'Sunucu dolu')
        return
      }

      const handshakeTimer = setTimeout(() => ws.terminate(), 10000)
      let state = { phase: 'handshake', id: cid, ip: assignedIp, ws, sharedKey: null }

      /* SERVER_HELLO gönder */
      ws.send(JSON.stringify({
        type:       'SERVER_HELLO',
        pubKey:     ecdh.getPublicKey('base64'),
        assignedIp,
        serverIp:   SERVER_IP,
        subnet:     `${SUBNET}.0/24`,
        mtu:        MTU,
      }))

      ws.on('message', (msg, isBinary) => {
        try {
          if (state.phase === 'handshake') {
            /* --- El Sıkışma --- */
            if (isBinary || msg.length > 4096) { ws.close(1008); return }
            const data = JSON.parse(msg.toString())

            if (data.type === 'CLIENT_HELLO') {
              /* PIN doğrula */
              if (!validToken(data.pin, this.pin)) {
                ws.send(JSON.stringify({ type: 'AUTH_FAIL', error: 'Geçersiz PIN' }))
                ws.close(1008)
                return
              }

              /* Paylaşılan sır türet */
              const clientPub = Buffer.from(data.pubKey, 'base64')
              const secret    = ecdh.computeSecret(clientPub)
              state.sharedKey = crypto.createHash('sha256').update(secret).digest()
              state.phase     = 'tunnel'
              clearTimeout(handshakeTimer)
              this.clients.set(cid, state)
              this.clientsByIp.set(assignedIp, state)

              ws.send(JSON.stringify({ type: 'AUTH_OK', ip: assignedIp, serverIp: SERVER_IP, mtu: MTU }))
              console.log(`[XTP] Kimlik doğrulandı: ${cid} → ${assignedIp}`)
            }

          } else if (state.phase === 'tunnel') {
            /* --- Tünel Verisi --- */
            if (!isBinary || msg.length < 48) return
            try {
              const pkt = decrypt(state.sharedKey, msg)
              // Reject spoofed source addresses and malformed IPv4 frames.
              if (pkt.length < 20 || pkt.length > MTU || pkt[0] >> 4 !== 4 || (pkt[0] & 15) < 5 || (pkt[0] & 15) * 4 > pkt.length || pkt.readUInt16BE(2) !== pkt.length) return
              if ([...pkt.subarray(12, 16)].join('.') !== assignedIp) return
              this._writeTun(pkt)
            } catch (e) {
              // Hatalı paket — yoksay
            }
          }
        } catch (e) {
          ws.close(1008, 'Geçersiz el sıkışma')
        }
      })

      ws.on('close', () => {
        console.log(`[XTP] Bağlantı kapandı: ${cid} (${assignedIp})`)
        clearTimeout(handshakeTimer)
        this.ipPool.push(assignedIp)
        this.clients.delete(cid)
        this.clientsByIp.delete(assignedIp)
      })

      ws.on('error', (e) => {
        console.error(`[XTP] WS hatası (${cid}):`, e.message)
        ws.terminate()
      })
    })

    this.wss.on('error', (e) => console.error('[XTP] WSS hatası:', e.message))
  }
}

module.exports = XTPServer
