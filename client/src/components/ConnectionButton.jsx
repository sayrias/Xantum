import { t, useLocale } from '../i18n/useLocale.jsx'
import React from 'react'

/**
 * Bağlan / Bağlantıyı Kes Ana Butonu
 * Animasyonlu halka + durum göstergesi
 */
export default function ConnectionButton({ status, onClick }) {
  const { locale, numberLocale } = useLocale()
  const { connected, connecting } = status

  const state = connecting ? 'connecting' : connected ? 'connected' : 'disconnected'

  const icons = {
    connected:    <i className="fas fa-shield-alt" style={{ fontSize: '42px' }}></i>,
    disconnected: <i className="fas fa-power-off" style={{ fontSize: '42px' }}></i>,
    connecting:   null,
  }

  return (
    <div className="connection-section">
      {/* Dış parlak halka */}
      <div className="connection-ring">
        <div className={`connection-ring-outer ${state}`} />
        <div className="connection-ring-inner" />

        {/* Merkez buton */}
        <button
          id="connect-button"
          className={`connect-button ${state}`}
          onClick={onClick}
          disabled={connecting}
          title={connected ? t("Bağlantıyı kes") : t("VPN'e bağlan")}
        >
          {connecting ? (
            <div className="spinner" />
          ) : (
            <span className="connect-btn-icon">{icons[state]}</span>
          )}
        </button>
      </div>
    </div>
  )
}
