import React, { useEffect, useState } from 'react'
import './ServerSettings.css'

export default function ServerSettings() {
  const [host, setHost] = useState('')
  const [savedHost, setSavedHost] = useState('')
  const [token, setToken] = useState('')
  const [configured, setConfigured] = useState(false)
  const [busy, setBusy] = useState(false)
  const [feedback, setFeedback] = useState('')
  const [source, setSource] = useState('manual')
  const [label, setLabel] = useState('')
  const [editing, setEditing] = useState(false)
  const [loading, setLoading] = useState(true)
  const [visible, setVisible] = useState(false)
  useEffect(() => {
    let active = true
    Promise.resolve(window.electronAPI?.serverConfigLoad?.()).then(config => {
      if (active && config) {
        setHost(config.serverIp || ''); setSavedHost(config.serverIp || ''); setConfigured(!!config.configured)
        setSource(config.source || 'manual'); setLabel(config.profileLabel || 'Hazır bağlantı')
      }
    }).catch(() => { if (active) setFeedback('Kayıtlı sunucu okunamadı. Bilgileri yeniden kaydedin.') })
      .finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [])
  const save = async event => {
    event.preventDefault()
    if (busy) return
    setBusy(true); setFeedback('')
    try {
      const result = await window.electronAPI?.serverConfigSave?.({ serverIp: host.trim(), inviteToken: token })
      if (!result?.success) throw new Error(result?.error || 'Sunucu ayarları masaüstü uygulamasında kaydedilebilir.')
      setConfigured(true); setSavedHost(host.trim()); setSource('manual'); setEditing(false); setVisible(false); setToken(''); setFeedback('Sunucu kaydedildi. Ana sayfadan bağlanabilirsin.')
      window.dispatchEvent(new Event('xantum_server_changed'))
    } catch (error) { setFeedback(error.message) }
    finally { setBusy(false) }
  }
  return <section className="server-settings" aria-labelledby="server-settings-title" aria-busy={loading || busy}>
    <div className="server-settings-heading"><h3 id="server-settings-title">Sunucun</h3>
      {configured && <span className="server-settings-status"><i className="fas fa-check" aria-hidden="true" />{source === 'bundled' ? label : 'Bağlantı kayıtlı'}</span>}
    </div>
    {loading ? <p role="status">Bağlantı bilgileri okunuyor…</p> : configured && !editing ? <>
      <p>{source === 'bundled' ? 'Bu uygulama sunucun için hazırlandı. Adres ve anahtarın kayıtlı; ana sayfadan bağlanabilirsin.' : 'Adres ve katılım anahtarın kayıtlı. Ana sayfadan bağlanabilirsin.'}</p>
      <div className="server-settings-saved"><span>Sunucu adresi</span><strong dir="ltr">{host}</strong><span>Katılım anahtarı kayıtlı</span></div>
      <button type="button" className="server-settings-secondary" onClick={() => { setEditing(true); setFeedback('') }}>Bağlantıyı düzenle</button>
    </> : <form onSubmit={save}>
      <p>Sunucu kurulumu sonunda gösterilen bilgileri bir kez kaydet.</p>
      <label htmlFor="server-host">Sunucu IP adresi veya alan adı</label>
      <input id="server-host" value={host} onChange={event => setHost(event.target.value)} placeholder="vpn.example.com veya sunucu IP adresi" maxLength={253} required autoComplete="off" spellCheck="false" dir="ltr" />
      <label htmlFor="server-token">Katılım anahtarı</label>
      <div className="server-settings-key">
        <input id="server-token" type={visible ? 'text' : 'password'} value={token} onChange={event => setToken(event.target.value)} placeholder={configured ? 'Kayıtlı anahtarı korumak için boş bırak' : 'Sunucudan aldığın anahtar'} required={!configured} minLength={12} maxLength={256} autoComplete="off" spellCheck="false" dir="ltr" />
        <button type="button" className="server-settings-secondary" aria-controls="server-token" aria-pressed={visible} onClick={() => setVisible(value => !value)}>{visible ? 'Gizle' : 'Göster'}</button>
      </div>
      <div className="server-settings-actions">
        <button type="submit" disabled={busy}>{busy ? 'Kaydediliyor…' : 'Sunucuyu kaydet'}</button>
        {configured && <button type="button" className="server-settings-secondary" disabled={busy} onClick={() => { setEditing(false); setHost(savedHost); setToken(''); setVisible(false); setFeedback('') }}>Vazgeç</button>}
      </div>
    </form>}
    {feedback && <p className="server-settings-feedback" role="status">{feedback}</p>}
  </section>
}
