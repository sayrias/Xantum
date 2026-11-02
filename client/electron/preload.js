const { contextBridge, ipcRenderer } = require('electron')

// ============================================================
// PRELOAD — Güvenli IPC Köprüsü
// Renderer process (React) sadece bu API'ye erişebilir.
// Node.js veya Electron API'sine doğrudan erişim YOK.
// ============================================================

contextBridge.exposeInMainWorld('electronAPI', {
  locale: {
    get: () => ipcRenderer.invoke('locale:get'),
    set: locale => ipcRenderer.invoke('locale:set', locale),
    onChange: callback => {
      const listener = (_, value) => callback(value)
      ipcRenderer.on('locale:changed', listener)
      return () => ipcRenderer.removeListener('locale:changed', listener)
    },
  },
  // ---- VPN Kontrol ----
  vpn: {
    connect: (configPath) => ipcRenderer.invoke('vpn:connect', configPath),
    disconnect: (interfaceName) => ipcRenderer.invoke('vpn:disconnect', interfaceName),
    status: () => ipcRenderer.invoke('vpn:status'),
    stats: (interfaceName) => ipcRenderer.invoke('vpn:stats', interfaceName),
    getPublicIp: () => ipcRenderer.invoke('vpn:get-public-ip'),
    getIpInfo:   () => ipcRenderer.invoke('vpn:get-ip-info'),   /* IP + geo data */
    checkProtection: () => ipcRenderer.invoke('vpn:protection:check'),
    releaseProtection: () => ipcRenderer.invoke('vpn:protection:release'),
    installHelpers: () => ipcRenderer.invoke('vpn:helpers:install'),
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
    const listener = () => callback()
    ipcRenderer.on('tray-toggle-vpn', listener)
    return () => ipcRenderer.removeListener('tray-toggle-vpn', listener)
  },
  onNetworkStats: (callback) => ipcRenderer.on('network-stats', (event, data) => callback(data)),
  
  // Yeni özellikler
  setupServerViaSSH: (credentials) => ipcRenderer.invoke('setup-server-ssh', credentials),
  getNetworkStatus: () => ipcRenderer.invoke('get-network-status'),
  serverConfigLoad: () => ipcRenderer.invoke('server-config:load'),
  serverConfigSave: data => ipcRenderer.invoke('server-config:save', data),
  getChatConnection: () => ipcRenderer.invoke('chat:connection'),
  onProtectionChange: callback => {
    const listener = (_, status) => callback(status)
    ipcRenderer.on('vpn-protection-changed', listener)
    return () => ipcRenderer.removeListener('vpn-protection-changed', listener)
  },
  onVpnDisconnected: (callback) => {
    const listener = () => callback()
    ipcRenderer.on('vpn-disconnected', listener)
    return () => ipcRenderer.removeListener('vpn-disconnected', listener)
  },
  autoRegisterVPN: () => ipcRenderer.invoke('auto-register-vpn'),
  
  // Loglama
  log: (level, message) => ipcRenderer.send('app:log', { level, message }),

  // ---- Hata Yönetimi & Log Klasörü ----
  openLogDir: () => ipcRenderer.send('app:open-log-dir'),
  getLogPath: () => ipcRenderer.invoke('app:get-log-path'),
  onFatalError: (callback) => {
    const listener = (event, data) => callback(data)
    ipcRenderer.on('app:fatal-error', listener)
    return () => ipcRenderer.removeListener('app:fatal-error', listener)
  },

  // ---- Electron Ayarları (fullTunnel vb.) ----
  settingsSave: (data) => ipcRenderer.invoke('settings:save', data),
  settingsLoad: () => ipcRenderer.invoke('settings:load'),
})
