import React from 'react'
import { formatUptime } from '../hooks/useNetworkStats'

/**
 * Durum Paneli
 * - Bağlı/Bağlı Değil badge
 * - IP adresi + ülke bayrağı (API'den gerçek veri)
 * - Uptime sayacı
 * - Sunucu konumu (ISP + şehir + ülke)
 */
export default function StatusPanel({ status, publicIp, ipInfo, prevIp, uptime }) {
  const { connected, connecting } = status
  const state = connecting ? 'connecting' : connected ? 'connected' : 'disconnected'

  const stateText = {
    connected:    'Bağlı',
    disconnected: 'Bağlantı Kesildi',
    connecting:   'Bağlanıyor...',
  }

  /* Gerçek coğrafi bilgiler */
  const displayIp      = ipInfo?.ip      || publicIp || null
  const countryName    = ipInfo?.country || null
  const city           = ipInfo?.city    || null
  const isp            = ipInfo?.isp     || null
  const flag           = ipInfo?.flag    || ''

  /* Bağlı durumda ülke adı büyük harf label olarak */
  const ipLabel = connected
    ? `${countryName ? countryName.toUpperCase() + ' — ' : ''}ÇIKIŞ IP`
    : 'Gerçek IP'

  /* Sunucu konum satırı: ISP + şehir + ülke */
  const serverLocationLine = [isp, city, countryName].filter(Boolean).join(' — ') || 'Özel Ağ Tüneli'

  return (
    <div className="glass-card status-card">
      {/* Başlık + badge */}
      <div className="status-header">
        <span className="status-label">Bağlantı Durumu</span>
        <div id="status-badge" className={`status-badge ${state}`}>
          <div className="status-dot" />
          <span>{stateText[state]}</span>
        </div>
      </div>

      {/* IP Bilgisi */}
      <div className="ip-row">
        <div className="ip-info">
          <span className="ip-label">
            {connected
              ? <><i className="fas fa-lock" style={{ marginRight: '4px' }} /> {ipLabel}</>
              : <><i className="fas fa-globe" style={{ marginRight: '4px' }} /> Gerçek IP</>
            }
          </span>
          <span id="current-ip" className="ip-value">
            {displayIp || (
              <span>
                <span className="loading-dot">.</span>
                <span className="loading-dot">.</span>
                <span className="loading-dot">.</span>
              </span>
            )}
          </span>
          {connected && prevIp && prevIp !== displayIp && (
            <span style={{ fontSize: '10px', color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>
              Önceki: {prevIp}
            </span>
          )}
        </div>
        <span className="ip-flag" style={{ fontSize: '22px' }}>
          {flag || (connected
            ? <i className="fas fa-shield-alt" />
            : <i className="fas fa-globe-europe" />
          )}
        </span>
      </div>

      {/* Sunucu bilgisi (bağlı iken) */}
      {connected && (
        <div style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '6px 12px',
          background: 'rgba(0,212,170,0.06)',
          borderRadius: 'var(--radius-md)',
          border: '1px solid rgba(0,212,170,0.15)',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <span style={{ fontSize: '12px', color: 'var(--accent-green)' }}>
              <i className="fas fa-bolt" />
            </span>
            <div>
              <div style={{ fontSize: '11px', fontWeight: 600, color: 'var(--accent-green)' }}>
                {serverLocationLine}
              </div>
              <div style={{ fontSize: '10px', color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>
                Özel Ağ Tüneli · Aktif
              </div>
            </div>
          </div>
          <div style={{ textAlign: 'right' }}>
            <div style={{ fontSize: '10px', color: 'var(--text-muted)' }}>Süre</div>
            <div id="uptime-display" className="uptime-display" style={{ fontSize: '14px' }}>
              {formatUptime(uptime)}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
