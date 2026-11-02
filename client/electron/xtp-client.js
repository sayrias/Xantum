/**
 * xtp-client.js — Xantum Tünel Protokolü (XTP) İstemci Motoru
 *
 * Electron main process içinde çalışır.
 * Platform: Windows + Linux
 *
 * Bağlantı akışı:
 *  1. WebSocket bağlantısı kur
 *  2. ECDH anahtar değişimi (SERVER_HELLO / CLIENT_HELLO)
 *  3. PIN doğrulama → AUTH_OK
 *  4. TUN cihazı oluştur, IP & route ayarla
 *  5. Çift yönlü şifreli paket iletimi
 */

'use strict'

const { WebSocket }               = require('ws')
const crypto                      = require('crypto')
const { execFileSync, spawn }      = require('child_process')
const path                        = require('path')
const fs                          = require('fs')
const { endpoint } = require('./connection-config')
const { lookup } = require('node:dns').promises
const { NetworkProtection, trustedLinuxHelper, LINUX_ROOT } = require('./network-protection')

const IS_WIN   = process.platform === 'win32'
const IS_LINUX = process.platform === 'linux'
const CIPHER   = 'aes-256-gcm'

/* ---- Şifreleme ---- */
function encrypt(key, plaintext) {
  const iv     = crypto.randomBytes(12)
  const cipher = crypto.createCipheriv(CIPHER, key, iv)
  const body   = Buffer.concat([cipher.update(plaintext), cipher.final()])
  const tag    = cipher.getAuthTag()
  return Buffer.concat([iv, tag, body])
}

function decrypt(key, data) {
  const iv         = data.slice(0, 12)
  const tag        = data.slice(12, 28)
  const ciphertext = data.slice(28)
  const decipher   = crypto.createDecipheriv(CIPHER, key, iv)
  decipher.setAuthTag(tag)
  return Buffer.concat([decipher.update(ciphertext), decipher.final()])
}

/* ---- TUN yardımcı binary yolu ---- */
function getHelperPath() {
  if (IS_LINUX) return trustedLinuxHelper(path.join(LINUX_ROOT, 'xtp-tun-helper'))
  // Electron paketi içinde: resources/bin/
  // Geliştirme: client/bin/
  let base
  try {
    const { app } = require('electron')
    base = app.isPackaged
      ? path.join(process.resourcesPath, 'bin')
      : path.join(__dirname, '..', 'bin')
  } catch {
    base = path.join(__dirname, '..', 'bin')
  }
  return IS_WIN
    ? path.join(base, 'xtp-tun-helper.exe')
    : path.join(base, 'xtp-tun-helper')
}

/* ================================================================
 * XTPClient
 * ================================================================ */
class XTPClient {
  constructor({ resolveHost = lookup, protection = new NetworkProtection() } = {}) {
    this.resolveHost = resolveHost
    this.protection = protection
    this.onProtectionChange = null
    this.protection.onChange = status => this.onProtectionChange?.(status)
    this.endpointCache = new Map()
    this.generation = 0
    this.windowsRoutes = []
    this.rxBytes = 0
    this.txBytes = 0
    this.connecting = false
    this.session = null
    this.ws            = null
    this.sharedKey     = null
    this.tunProcess    = null
    this.readBuf       = Buffer.alloc(0)
    this.connected     = false
    this.fullTunnel    = false  // true → tüm internet VPN'den geçer

    this.assignedIp    = null   // 10.8.0.X
    this.serverIp      = null   // 10.8.0.1
    this.serverEndpoint = null  // gerçek sunucu IP'si (WebSocket için)
    this.defaultGw     = null   // bağlantı öncesi kayıt
    this.defaultDev    = null

    /* Olaylar */
    this.onConnect    = null  // (assignedIp) => void
    this.onDisconnect = null  // () => void
    this.onError      = null  // (err) => void
  }

  get protectionState() { return this.protection.getState() }
  async probeProtection(options) { return this.protection.probe(options) }
  async installHelpers() {
    if (this.connected || this.connecting || this.session) throw new Error('Koruma kurulumundan önce VPN bağlantısını kesin.')
    return this.protection.installHelpers()
  }
  async releaseProtection() {
    if (this.connected || this.connecting || this.session) throw new Error('Koruma kaldırılmadan önce VPN bağlantısını kesin.')
    return this.protection.release()
  }

  /* ---- Bağlan ---- */
  async connect({ serverHost, wsPort = 8443, url, pin, fullTunnel = true, controlPorts = [] }) {
    if (this.connecting || this.session) throw new Error('Önce mevcut bağlantıyı kapatın.')
    const target = endpoint(url || `wss://${serverHost}:${wsPort}`, 'wss:')
    this.connecting = true
    const generation = ++this.generation
    const hostname = new URL(target).hostname
    let address
    try {
      // While a previous tunnel is locked, reuse its pinned endpoint instead of
      // opening a physical DNS exception. A first connection resolves once before arming.
      address = this.protection.getState().active && (this.endpointCache.get(hostname) || this.protection.savedEndpoint)
      if (!address) address = (await this.resolveHost(hostname, { family: 4 })).address
      this.endpointCache.set(hostname, address)
      if (generation !== this.generation) throw new Error('Bağlantı iptal edildi.')
      if (fullTunnel) await this.protection.arm({ endpoint: address, ports: [Number(new URL(target).port || (new URL(target).protocol === 'wss:' ? 443 : 80)), ...controlPorts] })
    } catch (error) { if (generation === this.generation) this.connecting = false; throw error }
    if (generation !== this.generation) throw new Error('Bağlantı iptal edildi.')
    this.serverEndpoint = address
    this.fullTunnel = fullTunnel
    this.rxBytes = this.txBytes = 0
    const ecdh = crypto.createECDH('prime256v1'); ecdh.generateKeys()
    let ws
    try {
      ws = new WebSocket(target, { handshakeTimeout: 10000, perMessageDeflate: false, maxPayload: 65564, minVersion: 'TLSv1.3',
        lookup: (_host, options, callback) => options?.all ? callback(null, [{ address, family: 4 }]) : callback(null, address, 4) })
    } catch (error) { this.connecting = false; await this.protection.block(error); throw error }
    this.ws = ws
    const session = { ws, setup: null, cleanup: null }
    this.session = session
    return new Promise((resolve, reject) => {
      let phase = 'hello', settled = false
      const deadline = setTimeout(() => finish(new Error('XTP bağlantısı zaman aşımına uğradı.')), 25000)
      const finish = error => {
        if (session.cleanup) return session.cleanup
        clearTimeout(deadline)
        const wasConnected = this.connected
        this.connected = false
        if (!settled) { settled = true; reject(error || new Error('XTP bağlantısı kapandı.')) }
        session.cleanup = (async () => {
          ws.terminate()
          try { await session.setup } catch {}
          if (this.fullTunnel) await this.protection.block(error)
          await this._teardownTun()
          this.sharedKey = null; this.assignedIp = null; this.ws = null
          this.session = null; this.connecting = false
          if (wasConnected && !session.manual) this.onDisconnect?.()
        })()
        return session.cleanup
      }
      session.finish = finish
      ws.on('error', error => { if (this.connected) this.onError?.(error); finish(error) })
      ws.on('close', () => finish())
      ws.on('message', async (msg, isBinary) => {
        try {
          if (phase === 'hello') {
            if (isBinary) throw new Error('Geçersiz XTP el sıkışması.')
            const data = JSON.parse(msg.toString())
            if (data.type !== 'SERVER_HELLO') throw new Error('XTP sunucu yanıtı geçersiz.')
            if (!/^10\.8\.0\.(?:[2-9]|[1-9]\d|1\d\d|2[0-4]\d|25[0-4])$/.test(data.assignedIp) || data.serverIp !== '10.8.0.1' || !Number.isInteger(data.mtu) || data.mtu < 576 || data.mtu > 1500) throw new Error('Geçersiz XTP ağ yapılandırması.')
            this.sharedKey = crypto.createHash('sha256').update(ecdh.computeSecret(Buffer.from(data.pubKey, 'base64'))).digest()
            this.assignedIp = data.assignedIp; this.serverIp = data.serverIp; this.mtu = data.mtu
            phase = 'auth'
            ws.send(JSON.stringify({ type: 'CLIENT_HELLO', pubKey: ecdh.getPublicKey('base64'), pin }))
          } else if (phase === 'auth') {
            if (isBinary) throw new Error('Geçersiz XTP kimlik yanıtı.')
            const data = JSON.parse(msg.toString())
            if (data.type !== 'AUTH_OK') throw new Error(data.error || 'Kimlik doğrulama başarısız.')
            if (data.ip !== this.assignedIp || data.serverIp !== this.serverIp || data.mtu !== this.mtu) throw new Error('XTP yapılandırması değişti.')
            phase = 'setup'
            session.setup = this._setupTun(data.ip, data.serverIp, data.mtu)
            await session.setup
            if (session.cleanup || ws.readyState !== WebSocket.OPEN) return
            if (this.fullTunnel) await this.protection.bind(data.ip)
            if (session.cleanup || ws.readyState !== WebSocket.OPEN) return
            phase = 'tunnel'; this.connected = true; this.connecting = false
            clearTimeout(deadline); settled = true; resolve({ ip: data.ip }); this.onConnect?.(data.ip)
          } else if (phase === 'tunnel' && isBinary && msg.length >= 48) {
            try {
              const pkt = decrypt(this.sharedKey, msg)
              if (pkt.length > this.mtu || pkt[0] >> 4 !== 4) return
              this.rxBytes += pkt.length; this._writeTun(pkt)
            } catch {}
          }
        } catch (error) { finish(error) }
      })
    })
  }

  async disconnect() {
    this.generation++
    if (this.session?.finish) { this.session.manual = true; await this.session.finish() }
    else { this.connecting = false; this.connected = false; await this._teardownTun() }
    await this.protection.settled?.()
    if (this.protection.getState().active || this.protection.getState().state === 'error') await this.protection.release()
  }

  /* ---- TUN'a yaz ---- */
  _writeTun(pkt) {
    if (!this.tunProcess || !this.tunProcess.stdin.writable || this.tunProcess.stdin.writableLength > 1024 * 1024) return
    const hdr = Buffer.allocUnsafe(2)
    hdr.writeUInt16BE(pkt.length, 0)
    this.tunProcess.stdin.write(Buffer.concat([hdr, pkt]))
  }

  /* ---- TUN'dan veri oku → şifrele → sunucuya gönder ---- */
  _handleTunData(chunk) {
    this.readBuf = Buffer.concat([this.readBuf, chunk])
    while (this.readBuf.length >= 2) {
      const pktLen = this.readBuf.readUInt16BE(0)
      if (this.readBuf.length < 2 + pktLen) break
      const pkt    = this.readBuf.slice(2, 2 + pktLen)
      this.readBuf = this.readBuf.slice(2 + pktLen)

      if (this.connected && this.sharedKey && this.ws?.readyState === WebSocket.OPEN && this.ws.bufferedAmount < 1024 * 1024) {
        try {
          this.ws.send(encrypt(this.sharedKey, pkt))
          this.txBytes += pkt.length
        } catch (e) {
          console.error('[XTP Client] Gönderim hatası:', e.message)
        }
      }
    }
  }

  /* ==============================================================
   * TUN Kurulum / Temizlik
   * ============================================================== */
  async _setupTun(assignedIp, serverIp, mtu) {
    this.mtu = mtu || 1380
    if (IS_WIN)   return this._setupTunWindows(assignedIp, serverIp)
    if (IS_LINUX) return this._setupTunLinux(assignedIp, serverIp)
    throw new Error('Desteklenmeyen platform')
  }

  /* ---- Linux TUN ---- */
  async _setupTunLinux(assignedIp, serverIp) {
    const iface = 'xtp0'
    const mask  = '255.255.255.0'

    /* Default gateway ve çıkış arayüzünü bul */
    let gateway   = ''
    let egressDev = ''
    try {
      const route = JSON.parse(execFileSync('ip', ['-j', 'route', 'get', this.serverEndpoint], { encoding: 'utf8' }))[0]
      gateway = route.gateway || ''; egressDev = route.dev || ''
    } catch {}

    this.defaultGw  = gateway
    this.defaultDev = egressDev
    const serverEndpoint = this.serverEndpoint || serverIp || ''

    let existing = false
    try { execFileSync('ip', ['link', 'show', 'dev', iface], { stdio: 'ignore' }); existing = true } catch {}
    if (existing) throw new Error('xtp0 arayüzü zaten kullanımda; önce mevcut VPN oturumunu kapatın.')

    const helperPath = getHelperPath()
    if (!fs.existsSync(helperPath)) throw new Error(`xtp-tun-helper bulunamadı: ${helperPath}`)

    if (!egressDev) throw new Error('Sunucuya fiziksel ağ rotası bulunamadı.')
    /* Root-owned broker only; polkit keeps the Electron renderer unprivileged. */
    const helperArgs = [
      iface,
      assignedIp,
      mask,
      String(this.mtu || 1380),
      serverEndpoint,   /* sunucu host rotası için */
      gateway,          /* default gateway */
      egressDev,        /* çıkış arayüzü */
      this.fullTunnel ? '1' : '0',
    ]

    this.tunProcess = spawn('/usr/bin/pkexec', [helperPath, ...helperArgs],
      { stdio: ['pipe', 'pipe', 'pipe'] })

    this.tunProcess.stdout.on('data', (d) => this._handleTunData(d))
    // A helper can exit after READY while the privileged bind operation is
    // still pending. Closing the socket also cancels that unfinished session.
    this.tunProcess.on('exit', () => this.ws?.terminate())
    this.tunProcess.stdin.on('error', () => this.ws?.terminate())

    await new Promise((resolve, reject) => {
      const t = setTimeout(() => reject(new Error('TUN hazır sinyali alınamadı (10s timeout)')), 10000)
      this.tunProcess.once('error', error => { clearTimeout(t); reject(error) })
      this.tunProcess.once('exit', code => { clearTimeout(t); reject(new Error(`TUN kapandı (${code})`)) })
      this.tunProcess.stderr.on('data', (d) => {
        const s = d.toString()
        console.log('[XTP TUN Linux]', s.trim())
        if (s.includes('TUN_READY')) { clearTimeout(t); resolve() }
        if (s.includes('ERROR'))     { clearTimeout(t); reject(new Error(s)) }
      })
      this.tunProcess.on('exit', (code) => {
        clearTimeout(t)
        if (code !== 0) reject(new Error(`xtp-tun-helper çıktı (kod: ${code})`))
      })
    })
  }

  /* ---- Windows TUN (WinTun) ---- */
  async _setupTunWindows(assignedIp, serverIp) {
    const helperPath = getHelperPath()
    if (!fs.existsSync(helperPath)) throw new Error(`xtp-tun-helper.exe bulunamadı: ${helperPath}`)

    const mask = '255.255.255.0'
    this.tunProcess = spawn(
      helperPath,
      ['xtp0', assignedIp, mask, String(this.mtu)],
      { stdio: ['pipe', 'pipe', 'pipe'] }
    )
    this.tunProcess.stdout.on('data', (d) => this._handleTunData(d))
    this.tunProcess.on('exit', () => this.ws?.terminate())
    this.tunProcess.stdin.on('error', () => this.ws?.terminate())

    await new Promise((resolve, reject) => {
      const t = setTimeout(() => reject(new Error('Windows TUN timeout')), 8000)
      this.tunProcess.once('error', error => { clearTimeout(t); reject(error) })
      this.tunProcess.once('exit', code => { clearTimeout(t); reject(new Error(`TUN kapandı (${code})`)) })
      this.tunProcess.stderr.on('data', (d) => {
        const s = d.toString().trim()
        console.log('[XTP TUN Win]', s)
        if (s.includes('TUN_READY')) { clearTimeout(t); resolve() }
        if (s.includes('ERROR'))     { clearTimeout(t); reject(new Error(s)) }
      })
    })

    // The WFP broker journals and installs owned routes atomically with its
    // recovery state during protection.bind(). No localized route print parsing.
  }

  /* ---- TUN Temizliği ---- */
  async _teardownTun() {
    if (!this.tunProcess) return
    /* Önce helper'ı durdur — C kodu çıkışta rotaları temizler */
    if (this.tunProcess) {
      const child = this.tunProcess
      // EOF lets native helper restore its own routes before exiting.
      if (!child.stdin.destroyed) child.stdin.end()
      await new Promise(resolve => {
        if (child.exitCode !== null || child.signalCode !== null) { resolve(); return }
        const timer = setTimeout(() => { try { child.kill('SIGTERM') } catch {}; resolve() }, 1000)
        child.once('exit', () => { clearTimeout(timer); resolve() })
      })
      this.tunProcess = null
    }

    /* Kısa bir süre rotaların temizlenmesini bekle */
    await new Promise(r => setTimeout(r, 300))

    // Linux client TUN is non-persistent and disappears when the helper closes it.

    if (IS_WIN) {
      for (const [command, args] of this.windowsRoutes.reverse()) {
        try { execFileSync(command, args) } catch {}
      }
      this.windowsRoutes = []
    }

    this.readBuf  = Buffer.alloc(0)
    this.defaultGw = null
  }
}

module.exports = XTPClient
