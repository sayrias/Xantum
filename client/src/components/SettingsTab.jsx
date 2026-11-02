import { t, useLocale } from '../i18n/useLocale.jsx'
import ServerSettings from './ServerSettings.jsx'
import React, { useState, useEffect, useRef } from 'react'

// Tuş atama bileşeni
function PttKeyBinder({ currentKey, onKeyChange }) {
  useLocale()
  const [listening, setListening] = useState(false);

  const startListen = () => setListening(true);

  useEffect(() => {
    if (!listening) return;
    const onKey = (e) => {
      e.preventDefault();
      onKeyChange(e.code); // örn: "CapsLock", "KeyV", "F1"
      setListening(false);
    };
    window.addEventListener('keydown', onKey, { once: true });
    return () => window.removeEventListener('keydown', onKey);
  }, [listening]);

  return (
    <div style={{ background: 'rgba(255,255,255,0.03)', padding: '12px 15px', borderRadius: '8px', border: '1px solid rgba(255,255,255,0.05)' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <span style={{ fontSize: '11px', color: 'var(--text-primary)' }}>{t("Atanan Tuş")}</span>
          <div style={{
            marginTop: '6px',
            display: 'inline-block',
            background: listening ? 'rgba(139,92,246,0.3)' : 'rgba(0,0,0,0.4)',
            border: `1px solid ${listening ? 'var(--accent-purple)' : 'rgba(255,255,255,0.15)'}`,
            padding: '4px 12px',
            borderRadius: '6px',
            fontFamily: 'monospace',
            fontSize: '13px',
            color: listening ? 'var(--accent-purple)' : 'var(--text-primary)',
            letterSpacing: '1px',
            marginLeft: '10px'
          }}>
            {listening ? '...' : (currentKey || 'CapsLock')}
          </div>
        </div>
        <button
          onClick={startListen}
          style={{
            background: listening ? 'rgba(139,92,246,0.3)' : 'var(--accent-purple)',
            border: `1px solid ${listening ? 'var(--accent-purple)' : 'transparent'}`,
            color: 'white', padding: '6px 14px', borderRadius: '6px',
            fontSize: '11px', cursor: 'pointer', fontWeight: 'bold'
          }}
        >
          {listening ? t("Tuşa bas...") : t("Değiştir")}
        </button>
      </div>
      <p style={{ margin: '8px 0 0 0', fontSize: '10px', color: 'var(--text-muted)' }}>{t(" Ses kanalındayken bu tuşa basılı tuttuğun sürece mikrofon açılır. ")}</p>
    </div>
  );
}

export default function SettingsTab() {
  const { locale, numberLocale } = useLocale()
  const [settings, setSettings] = useState({
    autoStart: true,
    notifications: true,
    autoConnect: false,
    killSwitch: true,
    fullTunnel: true,
    micDeviceId: 'default',
    speakerDeviceId: 'default',
    micLoopback: false,
    micGain: 100,
    masterVolume: 100,
    noiseGate: false,
    gateThreshold: 8,
    autoGate: false,
    pttEnabled: false,
    pttKey: 'CapsLock'
  })

  const [tempName, setTempName] = useState('')
  const [nameSaved, setNameSaved] = useState(false)

  const [devices, setDevices] = useState({ audioinput: [], audiooutput: [] })
  const [volume, setVolume] = useState(0)
  const audioContextRef = useRef(null)
  const analyserRef = useRef(null)
  const streamRef = useRef(null)
  const animationRef = useRef(null)

  // Ayarları yükle
  useEffect(() => {
    const loadAll = async () => {
      try {
        const saved = localStorage.getItem('xantum_settings')
        if (saved) {
          const parsed = JSON.parse(saved)
          setSettings(prev => ({ ...prev, ...parsed }))
          if (parsed.nickname) setTempName(parsed.nickname)
        }
      } catch (e) {}
      // Electron seviyesi ayarları da yükle (fullTunnel)
      try {
        if (window.electronAPI && window.electronAPI.settingsLoad) {
          const elSettings = await window.electronAPI.settingsLoad()
          if (elSettings && typeof elSettings.fullTunnel === 'boolean') {
            setSettings(prev => ({ ...prev, fullTunnel: elSettings.fullTunnel }))
          }
        }
      } catch (e) {}
    }
    loadAll()
  }, [])

  // Ayarları kaydet
  useEffect(() => {
    localStorage.setItem('xantum_settings', JSON.stringify(settings))
    // fullTunnel electron'a da kaydet
    try {
      if (window.electronAPI && window.electronAPI.settingsSave) {
        window.electronAPI.settingsSave({ fullTunnel: settings.fullTunnel })
      }
    } catch {}
  }, [settings])

  // Cihazları getir
  useEffect(() => {
    const getDevices = async () => {
      try {
        const permissionStream = await navigator.mediaDevices.getUserMedia({ audio: true })
        permissionStream.getTracks().forEach(track => track.stop())
        const allDevices = await navigator.mediaDevices.enumerateDevices()
        const audioinput = allDevices.filter(d => d.kind === 'audioinput')
        const audiooutput = allDevices.filter(d => d.kind === 'audiooutput')
        setDevices({ audioinput, audiooutput })
      } catch (err) {
        console.error(t("Cihazlara erişilemedi:"), err)
      }
    }
    getDevices()
  }, [])

  // Mikrofon Testi
  useEffect(() => {
    let active = true;
    let localAudioContext = null;

    const startMicTest = async () => {
      try {
        if (streamRef.current) {
          streamRef.current.getTracks().forEach(t => t.stop())
        }
        
        let audioConstraints = { 
          deviceId: settings.micDeviceId !== 'default' ? { exact: settings.micDeviceId } : undefined,
          autoGainControl: false
        };

        const stream = await navigator.mediaDevices.getUserMedia({ audio: audioConstraints })
        if (!active) {
          stream.getTracks().forEach(t => t.stop())
          return;
        }
        streamRef.current = stream
        
        localAudioContext = new (window.AudioContext || window.webkitAudioContext)()
        
        const source = localAudioContext.createMediaStreamSource(stream)
        
        // Kazanç (Gain) ayarı
        const gainNode = localAudioContext.createGain()
        gainNode.gain.value = (settings.micGain !== undefined ? settings.micGain : 100) / 100
        
        source.connect(gainNode)

        const analyser = localAudioContext.createAnalyser()
        analyser.fftSize = 256
        gainNode.connect(analyser)
        analyserRef.current = analyser
        
        // Kendimi duy (Loopback) - Master Volume da ekle
        if (settings.micLoopback) {
          const masterGain = localAudioContext.createGain()
          masterGain.gain.value = (settings.masterVolume !== undefined ? settings.masterVolume : 100) / 100
          gainNode.connect(masterGain)
          masterGain.connect(localAudioContext.destination)
        }
        
        const dataArray = new Uint8Array(analyser.frequencyBinCount)
        
        // Yazılımsal basit bir gürültü kapısı (Noise Gate) sadece görsel test için
        const checkVolume = () => {
          if (!active) return;
          if (analyserRef.current) {
            analyserRef.current.getByteFrequencyData(dataArray)
            const sum = dataArray.reduce((a, b) => a + b, 0)
            const avg = sum / dataArray.length
            setVolume(Math.min(100, Math.round((avg / 128) * 100))) 
          }
          animationRef.current = requestAnimationFrame(checkVolume)
        }
        checkVolume()
        
      } catch (err) {
        console.error(t("Mikrofon testi başlatılamadı:"), err)
      }
    }
    
    startMicTest()
    
    return () => {
      active = false;
      if (streamRef.current) streamRef.current.getTracks().forEach(t => t.stop())
      if (animationRef.current) cancelAnimationFrame(animationRef.current)
      if (localAudioContext) {
        localAudioContext.close().catch(console.error)
      }
    }
  }, [settings.micDeviceId, settings.noiseSuppression, settings.echoCancellation, settings.micLoopback, settings.micGain, settings.masterVolume])

  const toggleSetting = (key) => {
    setSettings(prev => {
      const next = { ...prev, [key]: !prev[key] };
      window.dispatchEvent(new CustomEvent('xantum_settings_update', { detail: next }));
      return next;
    })
  }

  const updateDevice = (key, val) => {
    setSettings(prev => {
      const next = { ...prev, [key]: val };
      window.dispatchEvent(new CustomEvent('xantum_settings_update', { detail: next }));
      return next;
    })
  }

  const handleSaveNickname = () => {
    updateDevice('nickname', tempName)
    setNameSaved(true)
    setTimeout(() => setNameSaved(false), 2000)
    window.dispatchEvent(new Event('xantum_profile_update'))
  }

  return (
    <div className="glass-card" style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '15px', overflowY: 'auto' }}>
      
      <ServerSettings />
      {/* GENEL AYARLAR */}
      <div>
        <h3 style={{ margin: '0 0 10px 0', fontSize: '14px', color: 'var(--text-primary)' }}>
          <i className="fas fa-sliders-h" style={{ marginRight: '6px' }}></i>{t(" Genel Ayarlar ")}</h3>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
          
          <div style={{ background: 'rgba(255,255,255,0.03)', padding: '10px 15px', borderRadius: '8px', border: '1px solid rgba(255,255,255,0.05)' }}>
            <h4 style={{ margin: '0 0 6px 0', fontSize: '12px' }}>{t("Kullanıcı Adı (Takma Ad)")}</h4>
            <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
              <input 
                type="text" 
                value={tempName} 
                onChange={e => setTempName(e.target.value)}
                placeholder={t("Ağda görünecek isminiz...")}
                style={{ flex: 1, padding: '8px', borderRadius: '4px', background: 'rgba(0,0,0,0.5)', color: 'white', border: '1px solid rgba(255,255,255,0.1)', fontSize: '11px', outline: 'none' }}
              />
              <button 
                onClick={handleSaveNickname}
                style={{ background: nameSaved ? 'var(--accent-green)' : 'var(--accent-purple)', color: nameSaved ? '#000' : '#fff', border: 'none', padding: '8px 12px', borderRadius: '4px', fontSize: '11px', fontWeight: 'bold', cursor: 'pointer', transition: '0.3s' }}
              >
                {nameSaved ? <><i className="fas fa-check"></i>{t(" Kaydedildi")}</> : t("Kaydet")}
              </button>
            </div>
          </div>

          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: 'rgba(255,255,255,0.03)', padding: '10px 15px', borderRadius: '8px', border: '1px solid rgba(255,255,255,0.05)' }}>
            <div>
              <h4 style={{ margin: '0 0 4px 0', fontSize: '12px' }}>{t("Sistemle Başlat")}</h4>
              <p style={{ margin: 0, fontSize: '10px', color: 'var(--text-muted)' }}>{t("Bilgisayar açıldığında otomatik başlasın.")}</p>
            </div>
            <button onClick={() => toggleSetting('autoStart')} className="toggle-btn" style={{ background: settings.autoStart ? 'var(--accent-purple)' : 'rgba(255,255,255,0.1)' }}>
              {settings.autoStart ? t("AÇIK") : t("KAPALI")}
            </button>
          </div>

          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: 'rgba(255,255,255,0.03)', padding: '10px 15px', borderRadius: '8px', border: '1px solid rgba(255,255,255,0.05)' }}>
            <div>
              <h4 style={{ margin: '0 0 4px 0', fontSize: '12px' }}>{t("Tam VPN · v1.0.0")}</h4>
              <p style={{ margin: 0, fontSize: '12px', color: 'var(--text-secondary)' }}>{t(" IPv4 trafiğin ve DNS isteklerin XTP tüneline yönlendirilir; IPv6 çıkışı engellenir.")}<br />{t(" Bağlantı kesilirse trafik kilitli kalır. Normal internete dönmek için korumayı kaldırabilirsin. ")}</p>
            </div>
          </div>
          
        </div>
      </div>

      <div style={{ height: '1px', background: 'rgba(255,255,255,0.1)', margin: '5px 0' }} />

      {/* SES VE MİKROFON AYARLARI */}
      <div>
        <h3 style={{ margin: '0 0 10px 0', fontSize: '14px', color: 'var(--text-primary)' }}>
          <i className="fas fa-microphone" style={{ marginRight: '6px' }}></i>{t(" Ses ve Mikrofon ")}</h3>
        
        <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
          
          <div style={{ background: 'rgba(255,255,255,0.03)', padding: '10px 15px', borderRadius: '8px', border: '1px solid rgba(255,255,255,0.05)' }}>
            <h4 style={{ margin: '0 0 6px 0', fontSize: '12px' }}>{t("Giriş Cihazı (Mikrofon)")}</h4>
            <select 
              value={settings.micDeviceId} 
              onChange={e => updateDevice('micDeviceId', e.target.value)}
              style={{ width: '100%', padding: '8px', borderRadius: '4px', background: 'rgba(0,0,0,0.5)', color: 'white', border: '1px solid rgba(255,255,255,0.1)', fontSize: '11px', outline: 'none' }}
            >
              <option value="default">{t("Sistem Varsayılanı")}</option>
              {devices.audioinput.map(d => (
                <option key={d.deviceId} value={d.deviceId}>{d.label || t('Mikrofon ({id})', { id: d.deviceId.slice(0,5) })}</option>
              ))}
            </select>
            
            <div style={{ marginTop: '10px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '10px', color: 'var(--text-muted)', marginBottom: '4px' }}>
                <span>{t("Mikrofon Testi")}</span>
                <span>{volume}%</span>
              </div>
              <div style={{ height: '6px', background: 'rgba(255,255,255,0.1)', borderRadius: '4px', overflow: 'hidden' }}>
                <div style={{ 
                  height: '100%', 
                  width: `${volume}%`, 
                  background: volume > 80 ? '#ff4757' : volume > 40 ? 'var(--accent-green)' : 'var(--accent-purple)',
                  transition: 'width 0.1s ease, background 0.2s ease'
                }} />
              </div>
            </div>

            <div style={{ marginTop: '15px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ fontSize: '11px', color: 'var(--text-primary)' }}>{t("Kendimi Duy (Loopback)")}</span>
                <button onClick={() => toggleSetting('micLoopback')} className="toggle-btn" style={{ background: settings.micLoopback ? 'var(--accent-purple)' : 'rgba(255,255,255,0.1)', padding: '4px 12px', fontSize: '10px' }}>
                  {settings.micLoopback ? t("AÇIK") : t("KAPALI")}
                </button>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '11px', color: 'var(--text-primary)' }}>
                  <span>{t("Mikrofon Ses Gücü (Gain)")}</span>
                  <span>{settings.micGain !== undefined ? settings.micGain : 100}%</span>
                </div>
                <input 
                  type="range" 
                  min="0" max="200" 
                  value={settings.micGain !== undefined ? settings.micGain : 100}
                  onChange={(e) => updateDevice('micGain', parseInt(e.target.value))}
                  style={{ width: '100%', accentColor: 'var(--accent-purple)' }}
                />
              </div>
            </div>
          </div>

          <div style={{ background: 'rgba(255,255,255,0.03)', padding: '10px 15px', borderRadius: '8px', border: '1px solid rgba(255,255,255,0.05)' }}>
            <h4 style={{ margin: '0 0 6px 0', fontSize: '12px' }}>{t("Çıkış Cihazı (Hoparlör)")}</h4>
            <select 
              value={settings.speakerDeviceId} 
              onChange={e => updateDevice('speakerDeviceId', e.target.value)}
              style={{ width: '100%', padding: '8px', borderRadius: '4px', background: 'rgba(0,0,0,0.5)', color: 'white', border: '1px solid rgba(255,255,255,0.1)', fontSize: '11px', outline: 'none', marginBottom: '10px' }}
            >
              <option value="default">{t("Sistem Varsayılanı")}</option>
              {devices.audiooutput.map(d => (
                <option key={d.deviceId} value={d.deviceId}>{d.label || t('Hoparlör ({id})', { id: d.deviceId.slice(0,5) })}</option>
              ))}
            </select>
            
            <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '11px', color: 'var(--text-primary)' }}>
                <span>{t("Ana Çıkış Sesi (Master Volume)")}</span>
                <span>{settings.masterVolume !== undefined ? settings.masterVolume : 100}%</span>
              </div>
              <input 
                type="range" 
                min="0" max="100" 
                value={settings.masterVolume !== undefined ? settings.masterVolume : 100}
                onChange={(e) => updateDevice('masterVolume', parseInt(e.target.value))}
                style={{ width: '100%', accentColor: '#00d4aa' }}
              />
            </div>
          </div>

        </div>

        {/* AKILLI SES EŞİĞİ (NOISE GATE) */}
        <div>
          <h3 style={{ margin: '0 0 10px 0', fontSize: '14px', color: 'var(--text-primary)' }}>
            <i className="fas fa-filter" style={{ marginRight: '6px' }}></i>{t(" Akıllı Ses Eşiği (Noise Gate) ")}</h3>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
            {/* Açma/Kapama */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: 'rgba(255,255,255,0.03)', padding: '10px 15px', borderRadius: '8px', border: '1px solid rgba(255,255,255,0.05)' }}>
              <div>
                <h4 style={{ margin: '0 0 2px 0', fontSize: '12px' }}>{t("Ses Eşiği Filtresi")}</h4>
                <p style={{ margin: 0, fontSize: '10px', color: 'var(--text-muted)' }}>{t("Belirli sesin altında kalan sesi keser. Nefes, tıklatma gibi sesleri filtreler.")}</p>
              </div>
              <button
                onClick={() => toggleSetting('noiseGate')}
                className="toggle-btn"
                style={{ background: settings.noiseGate ? 'var(--accent-purple)' : 'rgba(255,255,255,0.1)', flexShrink: 0, marginLeft: '10px' }}
              >
                {settings.noiseGate ? t("AÇIK") : t("KAPALI")}
              </button>
            </div>

            {settings.noiseGate && (
              <div style={{ background: 'rgba(255,255,255,0.03)', padding: '12px 15px', borderRadius: '8px', border: '1px solid rgba(255,255,255,0.05)', display: 'flex', flexDirection: 'column', gap: '12px' }}>
                {/* Otomatik Mod */}
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <div>
                    <span style={{ fontSize: '11px', color: 'var(--text-primary)', fontWeight: 'bold' }}>{t("Otomatik Eşik")}</span>
                    <p style={{ margin: '2px 0 0 0', fontSize: '10px', color: 'var(--text-muted)' }}>{t("Arka plan sessizliğini ölçerek eşiği otomatik ayarlar.")}</p>
                  </div>
                  <button
                    onClick={() => toggleSetting('autoGate')}
                    className="toggle-btn"
                    style={{ background: settings.autoGate ? '#00d4aa' : 'rgba(255,255,255,0.1)', flexShrink: 0, marginLeft: '10px' }}
                  >
                    {settings.autoGate ? t("AÇIK") : t("KAPALI")}
                  </button>
                </div>

                {/* Manuel Eşik Slider — autoGate kapalıysa göster */}
                {!settings.autoGate && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '11px' }}>
                      <span style={{ color: 'var(--text-primary)' }}>{t("Manuel Eşik Seviyesi")}</span>
                      <span style={{ color: 'var(--accent-purple)', fontWeight: 'bold' }}>{settings.gateThreshold}</span>
                    </div>
                    <input
                      type="range"
                      min="1" max="40"
                      value={settings.gateThreshold}
                      onChange={(e) => updateDevice('gateThreshold', parseInt(e.target.value))}
                      style={{ width: '100%', accentColor: 'var(--accent-purple)' }}
                    />
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '9px', color: 'var(--text-muted)' }}>
                      <span>{t("Hassas (1) — Az keser")}</span>
                      <span>{t("Agresif (40) — Çok keser")}</span>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>

        {/* BAS-KONUŞ (PTT) */}
        <div>
          <h3 style={{ margin: '0 0 10px 0', fontSize: '14px', color: 'var(--text-primary)' }}>
            <i className="fas fa-hand-pointer" style={{ marginRight: '6px' }}></i>{t(" Bas-Konuş (Push-to-Talk) ")}</h3>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: 'rgba(255,255,255,0.03)', padding: '10px 15px', borderRadius: '8px', border: '1px solid rgba(255,255,255,0.05)' }}>
              <div>
                <h4 style={{ margin: '0 0 2px 0', fontSize: '12px' }}>{t("Bas-Konuş Modu")}</h4>
                <p style={{ margin: 0, fontSize: '10px', color: 'var(--text-muted)' }}>{t("Sadece tuşa basılıyken mikrofon açılır. En etkili gürültü çözümü.")}</p>
              </div>
              <button
                onClick={() => toggleSetting('pttEnabled')}
                className="toggle-btn"
                style={{ background: settings.pttEnabled ? 'var(--accent-purple)' : 'rgba(255,255,255,0.1)', flexShrink: 0, marginLeft: '10px' }}
              >
                {settings.pttEnabled ? t("AÇIK") : t("KAPALI")}
              </button>
            </div>

            {settings.pttEnabled && (
              <PttKeyBinder
                currentKey={settings.pttKey}
                onKeyChange={(key) => updateDevice('pttKey', key)}
              />
            )}
          </div>
        </div>

      </div>
    </div>
  )
}
