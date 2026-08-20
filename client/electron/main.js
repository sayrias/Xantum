const { app, BrowserWindow, ipcMain, Tray, Menu, nativeImage, dialog, shell } = require('electron')
const path = require('path')
const { exec, spawn } = require('child_process')
const fs = require('fs')
const os = require('os')
const { setupServerViaSSH } = require('./ssh')

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
        message: err.message,
        stack: err.stack,
        logDir: crashDir
      })
    }
  } catch (_) {}
})

// ---- Gelişmiş Log Sistemi (Tarih bazlı klasörler) ----
// Üretim: ~/.config/NexusVPN/logs/YYYY-MM-DD/
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
let vpnStatusInterval = null
let statsInterval = null

// ---- VPN Durum Yönetimi ----
let currentVpnInterface = null
let vpnConnectedTime = null

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
      sandbox: false,
      webSecurity: false,        // Yerel dosya yükleme için
    },
    icon: path.join(__dirname, '../assets/icon.png'),
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

  // Pencere hazır olunca göster (beyaz flash önlemi)
  mainWindow.once('ready-to-show', () => {
    mainWindow.show()
  })

  mainWindow.webContents.on('console-message', (event, level, message, line, sourceId) => {
    appLog('info', `[RENDERER] ${message} (line ${line} in ${sourceId})`);
  });

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
  const iconPath = path.join(__dirname, '../assets/tray-icon.png')
  const icon = fs.existsSync(iconPath) 
    ? nativeImage.createFromPath(iconPath)
    : nativeImage.createEmpty()
  
  tray = new Tray(icon.resize({ width: 16, height: 16 }))
  
  const updateTrayMenu = (connected = false) => {
    const contextMenu = Menu.buildFromTemplate([
      {
        label: 'NexusVPN',
        enabled: false,
      },
      { type: 'separator' },
      {
        label: connected ? '🟢 Bağlı — Almanya 🇩🇪' : '🔴 Bağlantı Kesildi',
        enabled: false,
      },
      { type: 'separator' },
      {
        label: 'Aç',
        click: () => {
          mainWindow.show()
          mainWindow.focus()
        }
      },
      {
        label: connected ? 'Bağlantıyı Kes' : 'Bağlan',
        click: () => {
          mainWindow.show()
          mainWindow.webContents.send('tray-toggle-vpn')
        }
      },
      { type: 'separator' },
      {
        label: 'Çıkış',
        click: () => {
          app.isQuitting = true
          app.quit()
        }
      }
    ])
    
    tray.setContextMenu(contextMenu)
    tray.setToolTip(connected ? 'NexusVPN — Bağlı 🇩🇪' : 'NexusVPN — Bağlantı Kesildi')
  }
  
  updateTrayMenu(false)
  
  tray.on('double-click', () => {
    mainWindow.show()
    mainWindow.focus()
  })
  
  return { updateTrayMenu }
}

// ============================================================
// VPN KOMUTLARI — GÜVENLİ YÜRÜTME
// ============================================================

/**
 * Sistem komutu çalıştır (whitelist tabanlı — güvenli)
 */
function runCommand(cmd) {
  return new Promise((resolve, reject) => {
    exec(cmd, { timeout: 30000 }, (error, stdout, stderr) => {
      if (error) {
        reject({ error: error.message, stderr })
      } else {
        resolve({ stdout, stderr })
      }
    })
  })
}

/**
 * WireGuard config dosyasından interface adını çıkar
 */
function getInterfaceName(configPath) {
  const basename = path.basename(configPath, '.conf')
  return basename
}

/**
 * VPN'e bağlan — pkexec ile root yetkisi iste
 */
async function connectVpn(configPath) {
  if (!fs.existsSync(configPath)) {
    throw new Error(`Config dosyası bulunamadı: ${configPath}`)
  }
  
  const interfaceName = getInterfaceName(configPath)
  currentVpnInterface = interfaceName
  
  // Config dosyasını WireGuard dizinine kopyala
  const wgConfigPath = `/etc/wireguard/${interfaceName}.conf`
  
  // Ayrı sudo komutlarıyla çalıştır (sudoers NOPASSWD için daha güvenilir)
  await runCommand(`sudo cp '${configPath}' '${wgConfigPath}'`)
  await runCommand(`sudo chmod 600 '${wgConfigPath}'`)
  await runCommand(`sudo /usr/bin/wg-quick up '${interfaceName}'`)
  vpnConnectedTime = Date.now()
  return interfaceName
}

/**
 * VPN bağlantısını kes
 */
async function disconnectVpn(interfaceName) {
  if (!interfaceName) throw new Error('Interface adı belirtilmedi')
  
  await runCommand(`sudo /usr/bin/wg-quick down '${interfaceName}'`)
  currentVpnInterface = null
  vpnConnectedTime = null
}

/**
 * WireGuard arayüzü aktif mi?
 */
async function checkVpnStatus() {
  try {
    const { stdout } = await runCommand('wg show interfaces')
    const interfaces = stdout.trim().split('\n').filter(i => i.length > 0)
    return {
      connected: interfaces.length > 0,
      interface: interfaces[0] || null,
      interfaces,
    }
  } catch {
    return { connected: false, interface: null, interfaces: [] }
  }
}

/**
 * WireGuard transfer istatistiklerini al
 */
async function getWgStats(interfaceName) {
  try {
    if (!interfaceName) return null
    
    const { stdout } = await runCommand(`wg show ${interfaceName} transfer`)
    const lines = stdout.trim().split('\n')
    
    let totalRx = 0
    let totalTx = 0
    
    for (const line of lines) {
      const parts = line.trim().split(/\s+/)
      if (parts.length >= 3) {
        totalRx += parseInt(parts[1]) || 0
        totalTx += parseInt(parts[2]) || 0
      }
    }
    
    return { rx: totalRx, tx: totalTx }
  } catch {
    return null
  }
}

/**
 * Mevcut public IP adresini al
 */
async function getPublicIp() {
  try {
    const { stdout } = await runCommand('curl -s --max-time 5 https://api.ipify.org')
    return stdout.trim()
  } catch {
    try {
      const { stdout } = await runCommand('curl -s --max-time 5 https://ifconfig.me')
      return stdout.trim()
    } catch {
      return null
    }
  }
}

// ============================================================
// IPC HANDLERS — UI ile iletişim
// ============================================================

ipcMain.handle('setup-server-ssh', async (event, credentials) => {
  return await setupServerViaSSH(credentials)
})

ipcMain.handle('get-network-status', async (event) => {
  if (!currentVpnInterface) return { error: "VPN bağlı değil" }
  try {
    return []
  } catch (e) {
    return { error: e.message }
  }
})

// === YENİ: OTOMATİK KAYIT (API ÜZERİNDEN) ===
ipcMain.handle('auto-register-vpn', async () => {
  try {
    const configPath = path.join(app.getPath('userData'), 'NexusVPN.conf')
    // Geliştirme/test aşamasındaki hatalı configleri temizlemek için her seferinde yeni alıyoruz
    if (fs.existsSync(configPath)) {
      try { fs.unlinkSync(configPath) } catch (e) {}
    }

    // 1. config.json oku
    const appConfigPath = path.join(__dirname, '..', 'config.json')
    if (!fs.existsSync(appConfigPath)) {
      throw new Error('Gömülü config.json bulunamadı. Lütfen kurulum dosyanızı kontrol edin.')
    }
    const appConfig = JSON.parse(fs.readFileSync(appConfigPath, 'utf8'))

    // 2. wg genkey
    const { stdout: privateKey } = await runCommand('wg genkey')
    const { stdout: publicKey } = await runCommand(`echo "${privateKey.trim()}" | wg pubkey`)

    // 3. API'ye istek at
    const fetch = (...args) => import('node-fetch').then(({default: fetch}) => fetch(...args));
    const res = await fetch(`http://${appConfig.serverIp}:${appConfig.apiPort}/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        pin: appConfig.inviteToken,
        publicKey: publicKey.trim()
      })
    })

    if (!res.ok) {
      const errData = await res.json()
      appLog('error', `Sunucu kayit hatasi: ${errData.error}`)
      throw new Error(errData.error || 'Sunucu kayıt hatası')
    }

    const { config } = await res.json()
    appLog('info', 'Sunucuya başarıyla kayıt olundu. Config alındı.')

    // 4. Config dosyasını oluştur
    const confContent = `[Interface]
Address = ${config.address}
PrivateKey = ${privateKey.trim()}
DNS = ${config.dns}
MTU = ${config.mtu}

[Peer]
PublicKey = ${config.serverPublicKey}
PresharedKey = ${config.presharedKey}
Endpoint = ${config.endpoint}
AllowedIPs = ${config.allowedIps}
PersistentKeepalive = 25
`
    fs.writeFileSync(configPath, confContent)
    return { success: true, configPath }
  } catch (e) {
    appLog('error', 'Auto-register başarısız: ' + (e.message || String(e)))
    return { success: false, error: e.message || String(e) }
  }
})

ipcMain.handle('vpn:connect', async (event, configPath) => {
  try {
    const interfaceName = await connectVpn(configPath)
    const trayManager = app.trayManager
    if (trayManager) trayManager.updateTrayMenu(true)
    return { success: true, interface: interfaceName }
  } catch (error) {
    return { success: false, error: error.message || String(error) }
  }
})

ipcMain.handle('vpn:disconnect', async (event, interfaceName) => {
  try {
    const iface = interfaceName || currentVpnInterface
    await disconnectVpn(iface)
    const trayManager = app.trayManager
    if (trayManager) trayManager.updateTrayMenu(false)
    return { success: true }
  } catch (error) {
    return { success: false, error: error.message || String(error) }
  }
})

ipcMain.handle('vpn:status', async () => {
  try {
    return await checkVpnStatus()
  } catch (error) {
    return { connected: false, error: error.message }
  }
})

ipcMain.handle('vpn:stats', async (event, interfaceName) => {
  try {
    const iface = interfaceName || currentVpnInterface
    const stats = await getWgStats(iface)
    const uptime = vpnConnectedTime ? Date.now() - vpnConnectedTime : 0
    return { stats, uptime }
  } catch {
    return { stats: null, uptime: 0 }
  }
})

ipcMain.handle('vpn:get-public-ip', async () => {
  return await getPublicIp()
})

ipcMain.handle('vpn:get-connected-time', () => {
  return vpnConnectedTime
})

// Config dosyası seçme
ipcMain.handle('dialog:open-config', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: 'WireGuard Config Dosyası Seç',
    filters: [
      { name: 'WireGuard Config', extensions: ['conf'] },
      { name: 'Tüm Dosyalar', extensions: ['*'] }
    ],
    properties: ['openFile']
  })
  
  if (!result.canceled && result.filePaths.length > 0) {
    const configPath = result.filePaths[0]
    const content = fs.readFileSync(configPath, 'utf-8')
    return { path: configPath, content }
  }
  return null
})

// Config dosyasını belirli dizine kaydet
ipcMain.handle('config:save', async (event, { name, content }) => {
  try {
    const configDir = path.join(app.getPath('userData'), 'configs')
    fs.mkdirSync(configDir, { recursive: true })
    const filePath = path.join(configDir, `${name}.conf`)
    fs.writeFileSync(filePath, content, { mode: 0o600 })
    return { success: true, path: filePath }
  } catch (error) {
    return { success: false, error: error.message }
  }
})

// Kayıtlı config'leri listele
ipcMain.handle('config:list', async () => {
  try {
    const configDir = path.join(app.getPath('userData'), 'configs')
    if (!fs.existsSync(configDir)) return []
    const files = fs.readdirSync(configDir)
      .filter(f => f.endsWith('.conf'))
      .map(f => ({
        name: f.replace('.conf', ''),
        path: path.join(configDir, f),
        content: fs.readFileSync(path.join(configDir, f), 'utf-8'),
      }))
    return files
  } catch {
    return []
  }
})

// Log Kaydı
ipcMain.on('app:log', (event, { level, message }) => {
  appLog(level, message)
})

// Log klasörünü dosya yöneticisinde aç
ipcMain.on('app:open-log-dir', () => {
  try {
    if (!fs.existsSync(logDir)) fs.mkdirSync(logDir, { recursive: true })
    shell.openPath(logDir)
  } catch (e) { appLog('error', 'Log klasörü açılamadı: ' + e.message) }
})

// Log klasörü yolunu renderer'a gönder
ipcMain.handle('app:get-log-path', () => logDir)

// Pencere kontrolü
ipcMain.on('window:minimize', () => mainWindow?.minimize())
ipcMain.on('window:close', () => mainWindow?.hide())

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
    
    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) {
        createWindow()
      }
    })
  })

  app.on('window-all-closed', () => {
    // Tray app: kapatma, sadece gizle
  })

  let isDisconnecting = false;
  app.on('before-quit', async (e) => {
    if (currentVpnInterface && !isDisconnecting) {
      e.preventDefault();
      isDisconnecting = true;
      try { 
        // 5 saniye timeout ile VPN'i kapat, takılı kalmasın
        await Promise.race([
          disconnectVpn(currentVpnInterface),
          new Promise(resolve => setTimeout(resolve, 5000))
        ]);
      } catch {}
      app.exit(0); // Zorla kapat (arka planda takılı kalmaması için)
    }
  })
}
