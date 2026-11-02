import { t, useLocale } from '../i18n/useLocale.jsx'
import React, { useState } from 'react'
import './ProtectionNotice.css'

export default function ProtectionNotice({ protection, connected, connecting, onReconnect, onRelease, onCheck, onInstall }) {
  const { locale, numberLocale } = useLocale()
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
      if (result?.success === false) setError(result.error || t("İşlem tamamlanamadı. Yeniden deneyin."))
    } catch (failure) { setError(failure.message || t("İşlem tamamlanamadı.")) }
    finally { setBusy(false) }
  }
  return <aside className={`protection-notice ${guarded ? 'is-guarded' : 'is-blocked'}`} aria-label={t("Trafik koruması")}>
    <div className="protection-notice-copy" role="status">
      <strong>{needsSetup ? t("Linux korumasını hazırla") : guarded ? t("Trafik koruması açık") : uncertain ? t("Ağ korumasını kontrol et") : protection.active ? t("İnternet erişimi koruma altında kilitli") : t("Koruma işlemi tamamlanamadı")}</strong>
      <p>{needsSetup ? t('İlk kez Bağlan’a bastığında gereken ağ yardımcıları yönetici onayıyla hazırlanır. İstersen kurulumu şimdi de tamamlayabilirsin.') + (protection.active ? ' ' + t('Önceki koruma oturumu kilitli tutuluyor; kurulumdan sonra durumunu denetle.') : '') : guarded ? t("DNS istekleri tünelden geçer. IPv6 çıkışı engellenir.") : uncertain ? t("Önceki koruma oturumunun durumu henüz doğrulanamadı. Devam etmeden önce denetleyebilirsin.") : protection.active ? t("VPN bağlantısı kurulana kadar trafik durdurulur. Yeniden bağlanabilir veya korumayı kaldırıp normal internete dönebilirsin.") : t(protection.error)}</p>
    </div>
    {!guarded && <div className="protection-notice-actions">
      {needsSetup ? <button disabled={busy || connecting || connected} onClick={() => run(onInstall)}>{busy ? t("Yönetici onayı bekleniyor…") : t("Korumayı kur")}</button> : <>
        {protection.active && !connected && <button disabled={busy || connecting} onClick={() => run(onReconnect)}>{t("Yeniden bağlan")}</button>}
        <button disabled={busy || connecting} onClick={() => run(onCheck)}>{t("Durumu denetle")}</button>
        {!connected && <button className="protection-release" disabled={busy || connecting} onClick={() => run(onRelease)}>{busy ? t("İşleniyor…") : t("İnterneti geri aç")}</button>}
      </>}
    </div>}
    {error && <p className="protection-notice-error" role="alert">{t(error)}</p>}
    {!error && needsSetup && protection.error && <p className="protection-notice-error" role="alert">{t(protection.setupError || protection.error)}</p>}
  </aside>
}
