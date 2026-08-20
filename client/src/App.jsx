import React, { useState, useEffect, useCallback } from 'react'
import logoImg from './assets/logo.png'
import ConnectionButton from './components/ConnectionButton.jsx'
import StatusPanel from './components/StatusPanel.jsx'
import StatsPanel from './components/StatsPanel.jsx'
import ChatTab from './components/ChatTab.jsx'
import SettingsTab from './components/SettingsTab.jsx'
import FatalErrorModal from './components/FatalErrorModal.jsx'
import { useVpnStatus } from './hooks/useVpnStatus.js'
import { useNetworkStats } from './hooks/useNetworkStats.js'

const API = window.electronAPI

export default function App() {
  const [activeTab, setActiveTab] = useState('home')
  const [selectedConfig, setSelectedConfig] = useState(null)
  const [error, setError] = useState(null)

  const { status, publicIp, prevIp, connect, disconnect } = useVpnStatus()
  const stats = useNetworkStats(status.connected, status.interface)

  // Error auto-clear
  useEffect(() => {
    if (status.connected) setError(null)
  }, [status.connected])

  useEffect(() => {
    if (status.error) {
      // Hata objesini string'e dönüştür
      const msg = typeof status.error === 'string'
        ? status.error
        : status.error?.message || JSON.stringify(status.error) || 'Bilinmeyen hata'
      API?.log('error', `UI VPN Hatası: ${msg}`)
      setError(msg)
      const t = setTimeout(() => setError(null), 6000)
      return () => clearTimeout(t)
    }
  }, [status.error])

  // Tray'den gelen toggle komutu
  useEffect(() => {
    if (!API) return
    const unsub = API.onTrayToggle(() => {
      handleToggle()
    })
    return unsub
  }, [status.connected, selectedConfig])

  const handleToggle = useCallback(async () => {
    if (status.connecting) return
    
    if (status.connected) {
      await disconnect()
    } else {
      if (!selectedConfig) {
        // Otomatik kayıt (API üzerinden) dene
        setError('Sunucuya bağlanılıyor...')
        try {
          const res = await API.autoRegisterVPN()
          if (res.success) {
            // Otomatik oluşturulan config'i seç ve bağlan
            setSelectedConfig({ name: 'Otomatik Config', path: res.configPath })
            await connect(res.configPath)
          } else {
            API?.log('error', `Otomatik kayıt başarısız: ${res.error}`)
            setError(res.error || 'Otomatik kayıt başarısız oldu.')
          }
        } catch (e) {
          API?.log('error', `Ağ hatası: ${e.message}`)
          setError(e.message)
        }
        return
      }
      await connect(selectedConfig.path)
    }
  }, [status, selectedConfig, connect, disconnect])

  const handleSelectConfig = (cfg) => {
    setSelectedConfig(cfg)
    setError(null)
    setActiveTab('home')
  }

  return (
    <>
      {/* Arka plan */}
      <div className="app-background" />
      
      <div className="app-container">
        {/* Custom titlebar */}
        <div className="titlebar">
          <div className="titlebar-logo">
            <div className="titlebar-logo-icon" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <img src={logoImg} alt="logo" style={{ width: '26px', height: '26px', objectFit: 'contain' }} />
            </div>
            <span className="titlebar-title">Xantum</span>
          </div>
          
          <div className="titlebar-tabs">
            <button
              className={`titlebar-tab-btn ${activeTab === 'home' ? 'active' : ''}`}
              onClick={() => setActiveTab('home')}
              title="Ana Sayfa"
            >
              <span className="titlebar-tab-icon"><i className="fas fa-home"></i></span>
              <span className="titlebar-tab-text">Ana Sayfa</span>
            </button>
            <button
              className={`titlebar-tab-btn ${activeTab === 'settings' ? 'active' : ''}`}
              onClick={() => setActiveTab('settings')}
              title="Ayarlar"
            >
              <span className="titlebar-tab-icon"><i className="fas fa-cog"></i></span>
              <span className="titlebar-tab-text">Ayarlar</span>
            </button>
            <button
              className={`titlebar-tab-btn ${activeTab === 'chat' ? 'active' : ''}`}
              onClick={() => setActiveTab('chat')}
              title="Sohbet & Ağ"
            >
              <span className="titlebar-tab-icon"><i className="fas fa-comment-dots"></i></span>
              <span className="titlebar-tab-text">Sohbet</span>
            </button>
          </div>
          
          <div className="titlebar-controls">
            <button
              id="minimize-btn"
              className="titlebar-btn"
              onClick={() => API?.window.minimize()}
              title="Küçült"
            >
              ─
            </button>
            <button
              id="close-btn"
              className="titlebar-btn close"
              onClick={() => API?.window.close()}
              title="Tray'e gönder"
            >
              ✕
            </button>
          </div>
        </div>
        
        {/* Ana içerik */}
        <div className="app-main">
          {/* Hata mesajı */}
          {error && (
            <div className="alert alert-error">
              <span>⚠️</span>
              <span>{error}</span>
            </div>
          )}



          {/* ===== HOME SEKMESİ ===== */}
          {activeTab === 'home' && (
            <>
              {/* Bağlantı halkası + butonu (Kalan boşluğu doldurup tam ortalar) */}
              <div style={{ flex: 1, display: 'flex', justifyContent: 'center', alignItems: 'center' }}>
                <ConnectionButton
                  status={status}
                  onClick={handleToggle}
                />
              </div>
              
              {/* Alt Alan: Durum ve İstatistikler Yan Yana */}
              <div style={{ 
                display: 'flex', 
                gap: '40px', 
                alignItems: 'flex-start',
                justifyContent: 'space-between',
                paddingBottom: '10px'
              }}>
                <div style={{ flex: 1, width: 'auto' }}>
                  <StatusPanel
                    status={status}
                    publicIp={publicIp}
                    prevIp={prevIp}
                    uptime={stats.uptime}
                  />
                </div>
                
                <div style={{ flex: 1 }}>
                  <StatsPanel stats={stats} connected={status.connected} />
                </div>
              </div>
            </>
          )}

          {/* ===== SETTINGS SEKMESİ ===== */}
          {activeTab === 'settings' && (
            <SettingsTab
              selectedConfig={selectedConfig}
              onSelectConfig={handleSelectConfig}
            />
          )}

          {/* ===== CHAT SEKMESİ (Persistant for Voice Chat) ===== */}
          <div style={{ display: activeTab === 'chat' ? 'flex' : 'none', flex: 1, flexDirection: 'column', overflow: 'hidden' }}>
            <ChatTab connected={status.connected} publicIp={publicIp} />
          </div>


        </div>
        
        {/* Alt bilgi çubuğu */}
        <div style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '6px 16px 0',
          borderTop: '1px solid rgba(255,255,255,0.04)',
          flexShrink: 0,
        }}>
          <span style={{ fontSize: '10px', color: 'var(--text-muted)' }}>
            Xantum v1.0.0
          </span>
          <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
            <div style={{
              width: '6px', height: '6px',
              borderRadius: '50%',
              background: status.connected ? '#00d4aa' : 'var(--text-muted)',
              boxShadow: status.connected ? '0 0 6px #00d4aa' : 'none',
            }} />
            <span style={{ fontSize: '10px', color: 'var(--text-muted)' }}>
              {status.connected ? 'Güvenli Bağlantı' : 'Korumasız'}
            </span>
          </div>
        </div>
      </div>
      <FatalErrorModal />
    </>
  )
}
