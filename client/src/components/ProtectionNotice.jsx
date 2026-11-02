import React, { useState } from 'react'
import './ProtectionNotice.css'

export default function ProtectionNotice({ protection, connected, connecting, onReconnect, onRelease, onCheck, onInstall }) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  if (!protection || (protection.state === 'inactive' && !protection.error)) return null
  const uncertain = protection.state === 'unknown' || protection.verified === false
  const guarded = protection.active && connected && !protection.blocked && !uncertain
  const needsSetup = protection.setupRequired
  const run = async action => {
    if (busy) return
    setBusy(true); setError('')
    try {
      const result = await action()
      if (result?.success === false) setError(result.error || 'İşlem tamamlanamadı. Yeniden deneyin.')
    } catch (failure) { setError(failure.message || 'İşlem tamamlanamadı.') }
    finally { setBusy(false) }
  }
  return <aside className={`protection-notice ${guarded ? 'is-guarded' : 'is-blocked'}`} aria-label="Trafik koruması">
    <div className="protection-notice-copy" role="status">
      <strong>{needsSetup ? 'Linux korumasını hazırla' : guarded ? 'Trafik koruması açık' : uncertain ? 'Ağ korumasını kontrol et' : protection.active ? 'İnternet erişimi koruma altında kilitli' : 'Koruma işlemi tamamlanamadı'}</strong>
      <p>{needsSetup ? `VPN için ağ yardımcılarının bir kez kurulması gerekiyor. “Korumayı kur” ile bilgisayarının yönetici onayını ver.${protection.active ? ' Önceki koruma oturumu kilitli tutuluyor; kurulumdan sonra durumunu denetle.' : ''}` : guarded ? 'DNS istekleri tünelden geçer. IPv6 çıkışı engellenir.' : uncertain ? 'Önceki koruma oturumunun durumu henüz doğrulanamadı. Devam etmeden önce denetleyebilirsin.' : protection.active ? 'VPN bağlantısı kurulana kadar trafik durdurulur. Yeniden bağlanabilir veya korumayı kaldırıp normal internete dönebilirsin.' : protection.error}</p>
    </div>
    {!guarded && <div className="protection-notice-actions">
      {needsSetup ? <button disabled={busy || connecting || connected} onClick={() => run(onInstall)}>{busy ? 'Yönetici onayı bekleniyor…' : 'Korumayı kur'}</button> : <>
        {protection.active && !connected && <button disabled={busy || connecting} onClick={() => run(onReconnect)}>Yeniden bağlan</button>}
        <button disabled={busy || connecting} onClick={() => run(onCheck)}>Durumu denetle</button>
        {!connected && <button className="protection-release" disabled={busy || connecting} onClick={() => run(onRelease)}>{busy ? 'İşleniyor…' : 'İnterneti geri aç'}</button>}
      </>}
    </div>}
    {error && <p className="protection-notice-error" role="alert">{error}</p>}
    {!error && needsSetup && protection.error && <p className="protection-notice-error" role="alert">{protection.setupError || protection.error}</p>}
  </aside>
}
