'use strict'
const { t, setLanguage, getLanguage, translateError, localizeResult } = require('./localization')
const { app, BrowserWindow, ipcMain, Tray, Menu, nativeImage, dialog, shell } = require('electron')
const path = require('path')
const fs = require('fs')
const XTPClient = require('./xtp-client')
const { connectionConfig } = require('./connection-config')
const { isTrustedFrame } = require('./ipc-security')
const { parseConfig, readConfig, writeConfig } = require('./config-store')
const { loadServerProfile } = require('./server-profile')
let activeConnectionConfig = null
let protectionReady = Promise.resolve()

// ---- Geliştirme mi production mu? ----
const isDev = process.env.NODE_ENV === 'development' || !app.isPackaged

// ---- EPIPE / Broken Pipe hatalarını sessizce yut (terminal kapanınca çıkan hata kutusu) ----
process.stdout.on('error', (err) => { if (err.code === 'EPIPE') process.exit(0) })
process.stderr.on('error', (err) => { if (err.code === 'EPIPE') process.exit(0) })
process.on('uncaughtException', (err) => {
  if (err.code === 'EPIPE') return
  try {
    const today = new Date().toISOString().slice(0, 10)
    const crashBase = app.isPackaged
      ? path.join(app.getPath('userData'), 'logs')
      : path.join(__dirname, '..', 'logs')
    const crashDir = path.join(crashBase, today)
    if (!fs.existsSync(crashDir)) fs.mkdirSync(crashDir, { recursive: true })
    const time = new Date().toISOString()
    const logLine = `[${time}] [FATAL] ${err.stack || err.message}\n`
    fs.appendFileSync(path.join(crashDir, `${today}-activity.log`), logLine)
    fs.appendFileSync(path.join(crashDir, `${today}-error.log`), logLine)
    // Pencere varsa renderer'a hata gönder
    const wins = BrowserWindow.getAllWindows()
    if (wins.length > 0) {
      wins[0].webContents.send('app:fatal-error', {
        message: translateError(err),
        stack: err.stack,
        logDir: crashDir
      })
    }
  } catch (_) {}
})

// ---- Gelişmiş Log Sistemi (Tarih bazlı klasörler) ----
// Üretim: ~/.config/Xantum/logs/YYYY-MM-DD/
// Geliştirme: client/logs/YYYY-MM-DD/
const logBaseDir = app.isPackaged
  ? path.join(app.getPath('userData'), 'logs')
  : path.join(__dirname, '..', 'logs')

// Bugünün log klasörünü ve dosya yollarını hesapla
function getLogPaths() {
  const today = new Date().toISOString().slice(0, 10) // 'YYYY-MM-DD'
  const dayDir = path.join(logBaseDir, today)
  return {
    dir: dayDir,
    activity: path.join(dayDir, `${today}-activity.log`), // Tüm olaylar
    error:    path.join(dayDir, `${today}-error.log`),    // Sadece hata/uyarılar
  }
}

function appLog(level, message) {
  try {
    const paths = getLogPaths()
    if (!fs.existsSync(paths.dir)) fs.mkdirSync(paths.dir, { recursive: true })

    const time = new Date().toISOString()
    const logLine = `[${time}] [${level.toUpperCase()}] ${message}\n`

    // Her şeyi activity log'a yaz
    fs.appendFileSync(paths.activity, logLine)

    // Hata seviyelerini ayrıca error log'a da yaz
    if (['error', 'warn', 'fatal'].includes(level.toLowerCase())) {
      fs.appendFileSync(paths.error, logLine)
    }

    if (isDev) {
      try { process.stdout.write(logLine) } catch (e) { /* EPIPE */ }
    }
  } catch (_) { /* Log yazma hatası sessizce geç */ }
}

// logDir'i dışarıdan erişilebilir yap (IPC handler'ları için)
const logDir = logBaseDir

appLog('info', `Uygulama başlatıldı — Log klasörü: ${logBaseDir}`)

// Linux GPU sorunları için
if (process.platform === 'linux') {
  app.commandLine.appendSwitch('--disable-gpu-sandbox')
  app.commandLine.appendSwitch('--disable-software-rasterizer')
  app.commandLine.appendSwitch('ignore-gpu-blocklist')
}

// ---- Global değişkenler ----
let mainWindow = null
let tray = null

// Language is loaded before creating any menus or user-facing errors.
function settingsFile() { return path.join(app.getPath('userData'), 'settings.json') }
function loadSettings() {
  try { return fs.existsSync(settingsFile()) ? readConfig(settingsFile()) : {} }
  catch { return {} }
}
setLanguage(loadSettings().locale === 'tr' ? 'tr' : 'en')
function changeLanguage(locale) {
  if (!['en', 'tr'].includes(locale)) throw new Error(t('Geçersiz dil seçimi.'))
  writeConfig(settingsFile(), { ...loadSettings(), fullTunnel: true, locale })
  setLanguage(locale)
  app.trayManager?.updateTrayMenu(xtpClient.connected)
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('locale:changed', { locale })
    mainWindow.webContents.send('vpn-protection-changed', localizeResult(xtpClient.protectionState))
  }
  return { locale }
}

// ---- VPN Durum Yönetimi (XTP tabanlı) ----
let vpnConnectedTime = null
const xtpClient = new XTPClient()

xtpClient.onProtectionChange = status => {
  try { mainWindow?.webContents.send('vpn-protection-changed', localizeResult(status)) } catch {}
  app.trayManager?.updateTrayMenu(xtpClient.connected)
}

// Bağlantı kop → UI'ya bildir
xtpClient.onDisconnect = () => {
  vpnConnectedTime = null
  try {
    const wins = BrowserWindow.getAllWindows()
    if (wins.length > 0) wins[0].webContents.send('vpn-disconnected')
  } catch {}
  if (app.trayManager) app.trayManager.updateTrayMenu(false)
}

// ============================================================
// PENCERE OLUŞTURMA
// ============================================================
function createWindow() {
  mainWindow = new BrowserWindow({
    width: 740,
    height: 600,
    minWidth: 740,
    minHeight: 600,
    frame: false,           // Custom titlebar kullanıyoruz
    transparent: false,     // Linux GPU uyumu için kapalı
    backgroundColor: '#070b14',  // Arka plan rengi (siyah flash önler)
    resizable: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,    // GÜVENLİK: Zorunlu
      nodeIntegration: false,    // GÜVENLİK: Devre dışı
      sandbox: true,
      webSecurity: true,        // Yerel dosya yükleme için
    },
    icon: (() => {
      const candidates = ['icon.png','logo.png','tray-icon.png','logo_square.png']
      for (const f of candidates) {
        const p = path.join(__dirname, '../assets', f)
        if (fs.existsSync(p)) return p
      }
      return undefined  // Electron varsayılan ikon kullanır
    })(),
    titleBarStyle: 'hidden',
    show: false,  // Hazır olunca göster
  })

  // URL yükle
  const distIndex = path.join(__dirname, '../dist/index.html')
  const distExists = fs.existsSync(distIndex)

  if (isDev) {
    // Geliştirme modunda her zaman dev server'ı yükle
    mainWindow.loadURL('http://localhost:5173')
  } else {
    // Sadece production'da veya build alındıysa dist'i yükle
    if (distExists) {
      mainWindow.loadFile(distIndex)
    } else {
      console.error("DIST KLASÖRÜ BULUNAMADI! Lütfen önce projeyi derleyin (npm run build).")
    }
  }

  // Some compositors do not paint a hidden window, so ready-to-show alone
  // can leave a fully loaded app invisible. Show once on either signal.
  const initialWindow = mainWindow
  let initiallyShown = false
  const showInitialWindow = () => {
    if (initiallyShown || initialWindow.isDestroyed()) return
    initiallyShown = true
    initialWindow.show()
  }
  mainWindow.once('ready-to-show', showInitialWindow)
  mainWindow.webContents.once('did-finish-load', showInitialWindow)

  mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  mainWindow.webContents.on('will-navigate', event => event.preventDefault())

  mainWindow.webContents.on('console-message', ({ level, message, lineNumber, sourceId }) => {
    appLog(level === 'warning' ? 'warn' : level === 'error' ? 'error' : 'info', `[RENDERER] ${message} (line ${lineNumber} in ${sourceId})`)
  })

  // Kapatma davranışı — tray'e küçült
  mainWindow.on('close', (event) => {
    if (!app.isQuitting) {
      event.preventDefault()
      mainWindow.hide()
    }
  })

  return mainWindow
}

// ============================================================
// SYSTEM TRAY
// ============================================================
function createTray() {
  /* Mevcut ikon dosyasını bul (icon.png yoksa alternatifler dene) */
  const iconCandidates = process.platform === 'win32'
    ? ['icon.ico', 'logo.png']
    : ['tray-icon.png', 'icon.png', 'logo.png', 'logo_square.png']
  let iconPath = null
  for (const f of iconCandidates) {
    const p = path.join(__dirname, '../assets', f)
    if (fs.existsSync(p)) { iconPath = p; break }
  }

  try {
    tray = iconPath ? new Tray(iconPath) : null
  } catch (e) {
    appLog('warn', 'Tray ikon yüklenemedi: ' + e.message)
    tray = null
  }

  if (!tray) return { updateTrayMenu: () => {} }

  const updateTrayMenu = (connected = false, locationLabel = '') => {
    const connLabel = connected
      ? `${t('Bağlı')}${locationLabel ? ' — ' + locationLabel : ''}`
      : xtpClient.protectionState?.active ? t('Trafik koruması: internet kilitli') : t('Bağlantı kesildi')

    const contextMenu = Menu.buildFromTemplate([
      { label: 'Xantum', enabled: false },
      { type: 'separator' },
      { label: connLabel, enabled: false },
      { type: 'separator' },
      {
        label: t('Aç'),
        click: () => { mainWindow.show(); mainWindow.focus() }
      },
      {
        label: connected ? t('Bağlantıyı Kes') : t('Bağlan'),
        click: () => {
          mainWindow.show()
          mainWindow.webContents.send('tray-toggle-vpn')
        }
      },
      {
        label: t('Korumayı kaldır ve interneti geri aç'),
        visible: Boolean(xtpClient.protectionState?.active && !connected),
        click: async () => {
          try { await xtpClient.releaseProtection(); protectionReady = Promise.resolve(xtpClient.protectionState) }
          catch (error) { dialog.showErrorBox(t('Koruma kaldırılamadı'), translateError(error)) }
        }
      },
      { type: 'separator' },
      {
        label: t('Çıkış'),
        click: () => { app.isQuitting = true; app.quit() }
      }
    ])

    tray.setContextMenu(contextMenu)
    tray.setToolTip(connected ? t('Xantum — Bağlı') : xtpClient.protectionState?.active ? t('Xantum — İnternet koruma altında kilitli') : t('Xantum — Bağlantı kesildi'))
  }

  updateTrayMenu(false)

  tray.on('double-click', () => {
    mainWindow.show()
    mainWindow.focus()
  })

  return { updateTrayMenu }
}

// ============================================================
// XTP VPN — GÜVENLİ YÜRÜTME
// ============================================================

/**
 * Mevcut public IP adresini al
 */
/* HTTPS-only IP discovery; location fields remain optional. */
async function getIpInfo() {
  const fetch = (...args) => import('node-fetch').then(({default: fetch}) => fetch(...args))

  /* Query only HTTPS endpoints. Never leak the lookup over cleartext HTTP. */
  const sources = [
    'https://api.ipify.org',
    'https://api4.my-ip.io/v2/ip.txt',
    'https://icanhazip.com',
  ]
  for (const url of sources) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(5000) })
      if (res.ok) {
        const text = (await res.text()).trim()
        if (/^(\d{1,3}\.){3}\d{1,3}$/.test(text))
          return { ip: text, country: null, city: null, isp: null, flag: '' }
      }
    } catch {}
  }
  return null
}

/* Eski adı sağlayan kısa dönüsçü̈: sadece IP metni */
async function getPublicIp() {
  const info = await getIpInfo()
  return info?.ip || null
}


const trustedSender = event => isTrustedFrame(event, mainWindow?.webContents, {
  isDev, indexPath: path.join(__dirname, '../dist/index.html'),
})
function handle(channel, callback) {
  ipcMain.handle(channel, async (event, ...args) => {
    if (!trustedSender(event)) throw new Error(t('Yetkisiz uygulama isteği.'))
    try { return localizeResult(await callback(event, ...args)) }
    catch (error) { error.message = translateError(error); throw error }
  })
}
function listen(channel, callback) {
  ipcMain.on(channel, (event, ...args) => { if (trustedSender(event)) callback(event, ...args) })
}

// ============================================================
// IPC HANDLERS — UI ile iletişim
// ============================================================

handle('locale:get', () => ({ locale: getLanguage() }))
handle('locale:set', (_, locale) => changeLanguage(locale))

handle('setup-server-ssh', async () => ({ success: false, error: t('Sunucu kurulumu için docs/SETUP.md içindeki TLS ve SSH adımlarını kullanın.') }))

handle('get-network-status', async (event) => {
  if (!xtpClient.connected) return { error: t('VPN bağlı değil') }
  try {
    return []
  } catch (e) {
    return { error: e.message }
  }
})

function readServerProfile() {
  return loadServerProfile({ userData: app.getPath('userData'), isPackaged: app.isPackaged,
    resourcesPath: process.resourcesPath, developmentProfile: process.env.XANTUM_CONNECTION_PROFILE,
    legacyFile: path.join(__dirname, '..', 'config.json') })
}
function readServerConfig() { return readServerProfile().config }
handle('server-config:load', () => {
  try {
    const { config, source, label } = readServerProfile()
    return { serverIp: config.serverIp, configured: true, source, profileLabel: label }
  }
  catch { return { configured: false } }
})
handle('server-config:save', async (_, data) => {
  try {
    await protectionReady
    if (xtpClient.protectionState?.active || xtpClient.protectionState?.state === 'unknown') throw new Error(t('Sunucuyu değiştirmeden önce trafik korumasını kaldırın.'))
    if (xtpClient.connected || xtpClient.connecting) throw new Error(t('Sunucuyu değiştirmeden önce VPN bağlantısını kesin.'))
    let existing
    try { existing = readServerConfig() } catch {}
    if (!data || typeof data !== 'object') throw new Error(t('Geçersiz sunucu ayarları.'))
    let config = connectionConfig({ serverIp: data.serverIp, inviteToken: data.inviteToken || existing?.pin })
    if (!data.inviteToken && existing?.serverIp !== config.serverIp) throw new Error(t('Yeni sunucu için katılım anahtarını girin.'))
    if (existing?.serverIp === config.serverIp) config = connectionConfig({ ...existing, pin: config.pin })
    writeConfig(path.join(app.getPath('userData'), 'server.json'), { ...config, profileOrigin: 'manual' })
    activeConnectionConfig = null
    return { success: true }
  } catch (error) { return { success: false, error: error.message } }
})

// === OTOMATİK KAYIT & BAĞLANTI (XTP Protokolü) ===
handle('auto-register-vpn', async () => {
  try {
    await protectionReady
    const appConfig = readServerConfig()
    // A crash-retained guard blocks ordinary DNS. Reuse only the same server's
    // previously registered config so the tunnel can reconnect through its exception.
    if (xtpClient.protectionState?.active) {
      const cachedPath = path.join(app.getPath('userData'), 'xtp-config.json')
      const cached = readConfig(cachedPath)
      const normalized = connectionConfig(cached)
      if (cached.protocol === 'xtp' && ['serverIp', 'pin', 'apiUrl', 'xtpUrl'].every(key => normalized[key] === appConfig[key])) {
        return { success: true, configPath: cachedPath }
      }
      throw new Error(t('Koruma açıkken sunucu değiştirilemez. Önce internet erişimini geri açın.'))
    }

    // 2. Sunucuya kayıt isteği at — XTP bağlantı bilgilerini al
    const fetch = (...args) => import('node-fetch').then(({default: fetch}) => fetch(...args))
    const res = await fetch(`${appConfig.apiUrl}/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pin: appConfig.pin }),
      signal: AbortSignal.timeout(10000), redirect: 'error', size: 65536
    })

    if (!res.ok) {
      const errData = await res.json()
      appLog('error', `Sunucu kayıt hatası: ${errData.error}`)
      throw new Error(translateError(errData.error || 'Sunucu kayıt hatası'))
    }

    const { config: responseConfig } = await res.json()
    const config = { ...responseConfig, ...appConfig }
    if (config.protocol !== 'xtp') {
      throw new Error(t('Sunucu XTP protokolünü desteklemiyor. Lütfen sunucuyu güncelleyin.'))
    }

    appLog('info', 'Sunucuya başarıyla kayıt olundu. XTP bağlantısı hazır.')

    // 3. XTP config dosyasına kaydet
    const xtpConfigPath = path.join(app.getPath('userData'), 'xtp-config.json')
    writeConfig(xtpConfigPath, config)

    return { success: true, configPath: xtpConfigPath }
  } catch (e) {
    appLog('error', 'Auto-register başarısız: ' + (e.message || String(e)))
    return { success: false, error: e.message || String(e) }
  }
})

handle('vpn:connect', async (event, configPath) => {
  try {
    await protectionReady
    // configPath artık xtp-config.json yolu veya null (otomatik okur)
    const xtpConfigPath = configPath || path.join(app.getPath('userData'), 'xtp-config.json')
    if (!fs.existsSync(xtpConfigPath)) {
      throw new Error(t('XTP config bulunamadı. Lütfen önce uygulamayı kurun (Bağlan butonuna tekrar basın).'))
    }
    const xtpConfig = readConfig(xtpConfigPath)

    const config = connectionConfig(xtpConfig)
    await xtpClient.connect({ serverHost: config.serverIp, url: config.xtpUrl, pin: config.pin, fullTunnel: true, controlPorts: [Number(new URL(config.apiUrl).port || 443)] })
    activeConnectionConfig = { ...config, iceServers: xtpConfig.iceServers || [] }

    vpnConnectedTime = Date.now()
    const trayManager = app.trayManager
    if (trayManager) trayManager.updateTrayMenu(true)
    return { success: true, interface: 'xtp0', ip: xtpClient.assignedIp }
  } catch (error) {
    appLog('error', 'VPN bağlantı hatası: ' + error.message)
    return { success: false, error: error.message || String(error) }
  }
})

handle('vpn:disconnect', async () => {
  try {
    await xtpClient.disconnect()
    vpnConnectedTime = null
    const trayManager = app.trayManager
    if (trayManager) trayManager.updateTrayMenu(false)
    return { success: true }
  } catch (error) {
    return { success: false, error: error.message || String(error) }
  }
})

handle('chat:connection', () => {
  if (!xtpClient.connected || !activeConnectionConfig) return null
  return { url: activeConnectionConfig.apiUrl, pin: activeConnectionConfig.pin, iceServers: activeConnectionConfig.iceServers }
})

handle('vpn:status', async () => {
  return {
    connected:  xtpClient.connected,
    connecting: xtpClient.connecting,
    protection: xtpClient.protectionState,
    interface:  xtpClient.connected ? 'xtp0' : null,
    ip:         xtpClient.assignedIp,
    interfaces: xtpClient.connected ? ['xtp0'] : [],
  }
})

handle('vpn:protection:check', async () => {
  protectionReady = xtpClient.probeProtection({ verify: true })
  return protectionReady
})
handle('vpn:helpers:install', async () => {
  try {
    if (xtpClient.connected || xtpClient.connecting) throw new Error(t('Koruma kurulumundan önce VPN bağlantısını kesin.'))
    const protection = await xtpClient.installHelpers()
    protectionReady = Promise.resolve(protection)
    return { success: true, protection }
  } catch (error) { return { success: false, error: error.message, protection: xtpClient.protectionState } }
})
handle('vpn:protection:release', async () => {
  try {
    await xtpClient.releaseProtection()
    protectionReady = Promise.resolve(xtpClient.protectionState)
    return { success: true, protection: xtpClient.protectionState }
  }
  catch (error) { return { success: false, error: error.message, protection: xtpClient.protectionState } }
})

handle('vpn:stats', async () => {
  // Counts plaintext IP packet bytes; excludes TLS framing.
  const uptime = vpnConnectedTime ? Date.now() - vpnConnectedTime : 0
  return { stats: { rx: xtpClient.rxBytes, tx: xtpClient.txBytes }, uptime }
})

handle('vpn:get-public-ip', async () => {
  return await getPublicIp()
})

/* Tam coğrafi bilgi: IP + ülke + şehir + ISP + bayrak */
handle('vpn:get-ip-info', async () => {
  return await getIpInfo()
})


handle('vpn:get-connected-time', () => {
  return vpnConnectedTime
})

// Ayarlar kaydet/yükle (fullTunnel gibi electron-seviyesi ayarlar için)
handle('settings:save', (event, data) => {
  try {
    if (data?.locale !== undefined) changeLanguage(data.locale)
    else writeConfig(settingsFile(), { ...loadSettings(), fullTunnel: true, locale: getLanguage() })
    return { success: true }
  } catch (e) {
    return { success: false, error: e.message }
  }
})

handle('settings:load', () => ({ ...loadSettings(), locale: getLanguage() }))

// Config dosyası seçme
handle('dialog:open-config', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: t('XTP Bağlantı Dosyası Seç'),
    filters: [
      { name: 'XTP JSON', extensions: ['json'] },
      { name: t('Tüm Dosyalar'), extensions: ['*'] }
    ],
    properties: ['openFile']
  })

  if (!result.canceled && result.filePaths.length > 0) {
    const configPath = result.filePaths[0]
    const content = JSON.stringify(readConfig(configPath), null, 2)
    connectionConfig(parseConfig(content))
    return { path: configPath, content }
  }
  return null
})

// Config dosyasını belirli dizine kaydet
handle('config:save', async (event, { name, content }) => {
  try {
    const configDir = path.join(app.getPath('userData'), 'configs')
    fs.mkdirSync(configDir, { recursive: true })
    if (!/^[a-zA-Z0-9_-]{1,64}$/.test(name)) throw new Error(t('Geçersiz dosya adı.'))
    connectionConfig(parseConfig(content))
    const filePath = path.join(configDir, `${name}.json`)
    writeConfig(filePath, parseConfig(content))
    return { success: true, path: filePath }
  } catch (error) {
    return { success: false, error: error.message }
  }
})

// Kayıtlı config'leri listele
handle('config:list', async () => {
  try {
    const configDir = path.join(app.getPath('userData'), 'configs')
    if (!fs.existsSync(configDir)) return []
    const files = fs.readdirSync(configDir)
      .filter(f => f.endsWith('.json'))
      .map(f => ({
        name: f.replace('.json', ''),
        path: path.join(configDir, f),
        content: JSON.stringify(readConfig(path.join(configDir, f)), null, 2),
      }))
    return files
  } catch {
    return []
  }
})

// Log Kaydı
listen('app:log', (event, { level, message }) => {
  if (['info', 'warn', 'error'].includes(level) && typeof message === 'string') appLog(level, message.slice(0, 4000))
})

// Log klasörünü dosya yöneticisinde aç
listen('app:open-log-dir', () => {
  try {
    if (!fs.existsSync(logDir)) fs.mkdirSync(logDir, { recursive: true })
    shell.openPath(logDir)
  } catch (e) { appLog('error', 'Log klasörü açılamadı: ' + e.message) }
})

// Log klasörü yolunu renderer'a gönder
handle('app:get-log-path', () => logDir)

// Pencere kontrolü
listen('window:minimize', () => mainWindow?.minimize())
listen('window:close', () => mainWindow?.hide())

// ============================================================
// APP LIFECYCLE
// ============================================================

// ---- TEK İNSTANCE KILIDI — çoklu açılmayı önler ----
const gotSingleInstanceLock = app.requestSingleInstanceLock()
if (!gotSingleInstanceLock) {
  // Zaten çalışıyor — mevcut pencereyi öne çıkar ve kapat
  app.quit()
} else {
  // İkinci çalıştırma girişiminde mevcut pencereyi öne çıkar
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore()
      if (isDev) mainWindow.reload() // Dev modunda sunucu yeniden başlamış olabilir, sayfayı yenile
      mainWindow.show()
      mainWindow.focus()
    }
  })

  app.whenReady().then(() => {
    createWindow()
    const trayManager = createTray()
    app.trayManager = trayManager
    protectionReady = xtpClient.probeProtection().catch(error => { appLog('error', 'Ağ koruması denetlenemedi: ' + error.message); throw error })
    // Attach a handler even when the renderer has not requested a protected action.
    protectionReady.catch(() => {})

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) {
        createWindow()
      }
    })
  })

  app.on('window-all-closed', () => {
    // Tray app: kapatma, sadece gizle
  })

  let isDisconnecting = false
  app.on('before-quit', async (e) => {
    app.isQuitting = true
    if (isDisconnecting) { e.preventDefault(); return }
    if ((xtpClient.ws || xtpClient.tunProcess || xtpClient.protectionState?.active) && !isDisconnecting) {
      e.preventDefault()
      isDisconnecting = true
      try {
        await xtpClient.disconnect()
      } catch (error) {
        isDisconnecting = false
        app.isQuitting = false
        mainWindow?.show()
        dialog.showErrorBox(t('Trafik koruması açık kaldı'), t('İnternet erişimi kilitli tutuluyor. Uygulamadaki İnterneti geri aç düğmesini kullanın.') + '\n\n' + translateError(error))
        return
      }
      app.exit(0)
    }
  })
}
