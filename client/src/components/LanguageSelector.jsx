import React, { useEffect, useId, useRef, useState } from 'react'
import { t, useLocale } from '../i18n/useLocale.jsx'
import './LanguageSelector.css'

const languages = [{ code: 'en', name: 'English' }, { code: 'tr', name: 'Türkçe' }]

export default function LanguageSelector() {
  const { locale, setLocale } = useLocale()
  const [open, setOpen] = useState(false)
  const root = useRef(null)
  const trigger = useRef(null)
  const options = useRef([])
  const id = useId()
  const selected = languages.findIndex(language => language.code === locale)
  useEffect(() => {
    if (!open) return
    options.current[selected]?.focus()
    const outside = event => { if (!root.current?.contains(event.target)) setOpen(false) }
    document.addEventListener('pointerdown', outside)
    return () => document.removeEventListener('pointerdown', outside)
  }, [open, selected])
  const close = () => { setOpen(false); trigger.current?.focus() }
  const navigate = event => {
    const index = options.current.indexOf(document.activeElement)
    if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close() }
    else if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
      event.preventDefault()
      const next = event.key === 'Home' ? 0 : event.key === 'End' ? languages.length - 1 : (index + (event.key === 'ArrowDown' ? 1 : -1) + languages.length) % languages.length
      options.current[next]?.focus()
    }
  }
  return <section className="language-setting" aria-labelledby={`${id}-label`}>
    <div className="language-setting-copy">
      <h3 id={`${id}-label`}><i className="fas fa-globe" aria-hidden="true" />{t('Language')}</h3>
      <p>{t('Changes apply immediately.')}</p>
    </div>
    <div className="language-picker" ref={root} onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false) }}>
      <button type="button" className="language-trigger" ref={trigger} id={`${id}-trigger`}
        aria-label={`${t('Language')}: ${languages[selected].name}`} aria-haspopup="menu" aria-expanded={open} aria-controls={open ? `${id}-menu` : undefined}
        onClick={() => setOpen(value => !value)} onKeyDown={event => { if (event.key === 'ArrowDown' || event.key === 'ArrowUp') { event.preventDefault(); setOpen(true) } }}>
        <span lang={locale}>{languages[selected].name}</span><i className={`fas fa-chevron-${open ? 'up' : 'down'}`} aria-hidden="true" />
      </button>
      {open && <div className="language-menu" id={`${id}-menu`} role="menu" aria-labelledby={`${id}-label`} onKeyDown={navigate}>
        {languages.map((language, index) => <button type="button" key={language.code} ref={element => { options.current[index] = element }}
          role="menuitemradio" aria-checked={locale === language.code} tabIndex={-1} lang={language.code}
          onClick={() => { setLocale(language.code); close() }}>
          <span>{language.name}</span>{locale === language.code && <i className="fas fa-check" aria-hidden="true" />}
        </button>)}
      </div>}
    </div>
  </section>
}
