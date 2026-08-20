const { contextBridge, ipcRenderer } = require('electron')

// ============================================================
// PRELOAD — Güvenli IPC Köprüsü
// Renderer process (React) sadece bu API'ye erişebilir.
// Node.js veya Electron API'sine doğrudan erişim YOK.
// ============================================================

contextBridge.exposeInMainWorld('electronAPI', {
  // ---- VPN Kontrol ----
  vpn: {
    connect: (configPath) => ipcRenderer.invoke('vpn:connect', configPath),
    disconnect: (interfaceName) => ipcRenderer.invoke('vpn:disconnect', interfaceName),
    status: () => ipcRenderer.invoke('vpn:status'),
    stats: (interfaceName) => ipcRenderer.invoke('vpn:stats', interfaceName),
    getPublicIp: () => ipcRenderer.invoke('vpn:get-public-ip'),
    getConnectedTime: () => ipcRenderer.invoke('vpn:get-connected-time'),
  },
  
  // ---- Dosya/Config ----
  dialog: {
    openConfig: () => ipcRenderer.invoke('dialog:open-config'),
  },
  config: {
    save: (data) => ipcRenderer.invoke('config:save', data),
    list: () => ipcRenderer.invoke('config:list'),
  },
  
  // ---- Pencere Kontrolü ----
  window: {
    minimize: () => ipcRenderer.send('window:minimize'),
    close: () => ipcRenderer.send('window:close'),
  },
  
  // ---- Tray mesajları dinle ----
  onTrayToggle: (callback) => {
    ipcRenderer.on('tray-toggle-vpn', callback)
    return () => ipcRenderer.removeAllListeners('tray-toggle-vpn')
  },
  onNetworkStats: (callback) => ipcRenderer.on('network-stats', (event, data) => callback(data)),
  
  // Yeni özellikler
  setupServerViaSSH: (credentials) => ipcRenderer.invoke('setup-server-ssh', credentials),
  getNetworkStatus: () => ipcRenderer.invoke('get-network-status'),
  autoRegisterVPN: () => ipcRenderer.invoke('auto-register-vpn'),
  
  // Loglama
  log: (level, message) => ipcRenderer.send('app:log', { level, message }),

  // ---- Hata Yönetimi & Log Klasörü ----
  openLogDir: () => ipcRenderer.send('app:open-log-dir'),
  getLogPath: () => ipcRenderer.invoke('app:get-log-path'),
  onFatalError: (callback) => {
    ipcRenderer.on('app:fatal-error', (event, data) => callback(data))
    return () => ipcRenderer.removeAllListeners('app:fatal-error')
  },
})
