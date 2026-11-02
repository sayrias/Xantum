'use strict'
const { t, translateError, localizeResult } = require('./localization')

const fs = require('node:fs')
const path = require('node:path')
const net = require('node:net')
const { execFile } = require('node:child_process')
const { installLinuxHelpers } = require('./linux-helper-installer')

const LINUX_ROOT = '/usr/local/libexec/xantum'
const LINUX_STATE = '/run/xantum-protection/state.json'
const LINUX_POLICY = '/usr/share/polkit-1/actions/org.xantum.helpers.policy'
const SETUP_MESSAGE = 'Linux ağ koruması kurulumu gerekli. Uygulamadaki “Korumayı kur” düğmesine basıp yönetici onayını verin.'

function setupError(cause) {
  const error = new Error(t(SETUP_MESSAGE), { cause })
  error.code = 'XANTUM_SETUP_REQUIRED'; error.setupRequired = true; error.setupError = t(SETUP_MESSAGE)
  return error
}

function packagedResources() {
  // Electron also exposes process.resourcesPath during development, where it
  // points at node_modules/electron rather than this project's native helpers.
  try { return require('electron').app?.isPackaged ? process.resourcesPath : undefined }
  catch { return undefined }
}

function execute(file, args) {
  return new Promise((resolve, reject) => execFile(file, args, { timeout: 30000, maxBuffer: 128 * 1024, windowsHide: true }, (error, stdout, stderr) => {
    if (error) { error.message = translateError(String(stderr || error.message).trim()); reject(error); return }
    try { resolve(JSON.parse(stdout)) } catch { reject(new Error(t('Ağ koruması yardımcısı geçersiz yanıt verdi.'))) }
  }))
}

// A privileged helper must never be executable from a user-writable directory.
function trustedLinuxHelper(file, stat = fs.lstatSync) {
  let current = file
  while (true) {
    const entry = stat(current)
    if (entry.isSymbolicLink() || entry.uid !== 0 || (entry.mode & 0o022)) throw new Error(t('Linux ağ yardımcısı ve üst klasörleri root sahipli ve yazmaya kapalı olmalı.'))
    if (current === '/') break
    current = path.dirname(current)
  }
  return file
}

class SystemProtectionAdapter {
  constructor({ platform = process.platform, run = execute, readFile = fs.readFileSync, stat = fs.lstatSync, resourcesPath = packagedResources(), install = installLinuxHelpers } = {}) {
    this.platform = platform; this.run = run; this.readFile = readFile; this.stat = stat
    this.resourcesPath = resourcesPath; this.install = install
    this.windowsHelper = path.join(resourcesPath || path.join(__dirname, '..'), 'bin', 'xtp-tun-helper.exe')
  }

  linuxSetupError() {
    try {
      trustedLinuxHelper(path.join(LINUX_ROOT, 'network-protection-linux.py'), this.stat)
      trustedLinuxHelper(path.join(LINUX_ROOT, 'xtp-tun-helper'), this.stat)
      trustedLinuxHelper(LINUX_POLICY, this.stat)
      const policy = this.readFile(LINUX_POLICY, 'utf8')
      if (!/<annotate\s+key=["']org\.freedesktop\.policykit\.imply["']>\s*org\.xantum\.tun\s*<\/annotate>/.test(policy)) {
        throw new Error(t('Linux yardımcılarının yetki ilkesi güncellenmeli.'))
      }
      return null
    } catch (error) { return setupError(error) }
  }

  async installHelpers() {
    if (this.platform !== 'linux') throw new Error(t('Bu işletim sisteminde ayrı Linux yardımcı kurulumu gerekmiyor.'))
    await this.install({ resourcesPath: this.resourcesPath })
    const error = this.linuxSetupError()
    if (error) throw error
    return this.status()
  }

  async status() {
    if (this.platform === 'linux') {
      const missing = this.linuxSetupError()
      const setup = missing ? { setupRequired: true, setupError: missing.message } : {}
      let journalExists = false
      try {
        const entry = this.stat(LINUX_STATE)
        journalExists = true
        if (entry.isSymbolicLink() || entry.uid !== 0 || (entry.mode & 0o022)) throw new Error(t('Koruma durum dosyasının sahipliği geçersiz.'))
        const saved = JSON.parse(this.readFile(LINUX_STATE, 'utf8'))
        if (saved.version !== 1 || !net.isIPv4(saved.endpoint) || !Array.isArray(saved.ports)) throw new Error(t('Koruma durumu okunamadı.'))
        // The journal is deliberately conservative: an interrupted operation is locked until
        // the privileged helper verifies/reconciles it. No elevation dialog on app startup.
        return { active: true, blocked: true, verified: false, endpoint: saved.endpoint, ports: saved.ports, ...setup }
      } catch (error) {
        if (error.code === 'ENOENT' && !journalExists) return { active: false, blocked: false, verified: false, ...setup }
        error.journalExists = true
        if (missing) { error.setupRequired = true; error.setupError = missing.message }
        throw error
      }
    }
    if (this.platform === 'win32') return this.run(this.windowsHelper, ['--protect', 'status'])
    throw new Error(t('Ağ koruması bu işletim sistemini desteklemiyor.'))
  }

  async command(operation, config = {}) {
    const args = [operation]
    if (operation === 'arm') args.push(config.endpoint, config.ports.join(','))
    if (operation === 'bind') args.push(config.assignedIp)
    if (this.platform === 'linux') {
      const missing = this.linuxSetupError()
      if (missing) throw missing
      const helper = path.join(LINUX_ROOT, 'network-protection-linux.py')
      try { return await this.run('/usr/bin/pkexec', [helper, ...args]) }
      catch (error) {
        if (error.code === 'ENOENT') throw new Error(t('Yönetici onayı aracı bulunamadı. Dağıtımınızın pkexec/polkit paketini kurup yeniden deneyin.'), { cause: error })
        throw error
      }
    }
    if (this.platform === 'win32') return this.run(this.windowsHelper, ['--protect', ...args])
    throw new Error(t('Ağ koruması bu işletim sistemini desteklemiyor.'))
  }
}

class NetworkProtection {
  constructor({ adapter = new SystemProtectionAdapter(), onChange = null } = {}) {
    this.adapter = adapter; this.onChange = onChange; this.queue = Promise.resolve()
    this.savedEndpoint = null; this.savedPorts = []
    this.state = { state: 'unknown', active: false, blocked: false, verified: false, error: null, setupRequired: false, setupError: null }
  }
  getState() { return localizeResult({ ...this.state }) }
  settled() { return this.queue }
  _set(state) { this.state = { ...this.state, ...state }; this.onChange?.(this.getState()); return this.getState() }
  _serial(action) { const next = this.queue.then(action); this.queue = next.catch(() => {}); return next }
  _accept(result, fallback) {
    if (result.endpoint) this.savedEndpoint = result.endpoint
    if (result.ports) this.savedPorts = result.ports
    return this._set({ state: result.active ? (result.blocked ? 'blocked' : fallback) : result.setupRequired ? 'setup-required' : 'inactive', active: !!result.active,
      blocked: !!result.blocked, verified: !!result.verified, error: null, setupRequired: !!result.setupRequired, setupError: result.setupError || null })
  }
  probe({ verify = false } = {}) { return this._serial(async () => {
    try { return this._accept(await (verify ? this.adapter.command('status') : this.adapter.status()), 'armed') }
    catch (error) { return this._set({ state: 'unknown', active: this.state.active || !!error.journalExists, blocked: this.state.blocked || !!error.journalExists, verified: false, error: error.message,
      ...(error.setupRequired ? { setupRequired: true, setupError: error.setupError || error.message } : {}) }) }
  }) }
  installHelpers() { return this._serial(async () => {
    try {
      if (typeof this.adapter.installHelpers !== 'function') throw new Error(t('Yardımcı kurulumu bu platformda desteklenmiyor.'))
      return this._accept(await this.adapter.installHelpers(), 'armed')
    } catch (error) {
      try { this._accept(await this.adapter.status(), 'armed') } catch (probeError) {
        this._set({ state: 'unknown', active: this.state.active || !!probeError.journalExists, blocked: this.state.blocked || !!probeError.journalExists, verified: false })
      }
      this._set({ verified: false, setupRequired: true, setupError: error.message, error: error.message })
      throw error
    }
  }) }
  arm({ endpoint, ports }) {
    if (!net.isIPv4(endpoint) || !Array.isArray(ports) || !ports.length || ports.length > 4 || ports.some(port => !Number.isInteger(port) || port < 1 || port > 65535)) return Promise.reject(new Error(t('Geçersiz koruma hedefi.')))
    return this._serial(async () => {
      try {
        const result = await this.adapter.command('arm', { endpoint, ports: [...new Set(ports)].sort((a, b) => a - b) })
        if (!result.active || !result.verified) throw new Error(t('Ağ koruması doğrulanamadı; bağlantı başlatılmadı.'))
        this.savedEndpoint = endpoint
        return this._accept(result, 'armed')
      } catch (error) {
        // An elevation/IPC failure can occur after rules commit. Never assume it means off.
        try { this._accept(await this.adapter.status(), 'armed') } catch {}
        this._set({ state: 'error', blocked: this.state.active, error: error.message }); throw error
      }
    })
  }
  bind(assignedIp) {
    if (!/^10\.8\.0\.(?:[2-9]|[1-9]\d|1\d\d|2[0-4]\d|25[0-4])$/.test(assignedIp)) return Promise.reject(new Error(t('Geçersiz tünel adresi.')))
    return this._serial(async () => {
      const result = await this.adapter.command('bind', { assignedIp })
      if (!result.active || !result.verified || result.blocked) throw new Error(t('Tünel koruması etkinleştirilemedi.'))
      return this._accept(result, 'armed')
    })
  }
  block(error) { return this._serial(async () => {
    if (!this.state.active) return this.getState()
    try { return this._accept(await this.adapter.command('block'), 'blocked') }
    catch (failure) { return this._set({ state: 'error', blocked: true, verified: false, error: failure.message || error?.message }) }
  }) }
  release() { return this._serial(async () => {
    try {
      const result = await this.adapter.command('release')
      if (result.active) throw new Error(t('Koruma kaldırılamadı; internet kilidi açık tutuldu.'))
      this.savedEndpoint = null; this.savedPorts = []
      return this._accept(result, 'inactive')
    } catch (error) { this._set({ state: 'error', blocked: this.state.active, error: error.message }); throw error }
  }) }
}

module.exports = { NetworkProtection, SystemProtectionAdapter, trustedLinuxHelper, LINUX_ROOT }
