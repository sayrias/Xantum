import React from 'react'
import { t, useLocale } from '../i18n/useLocale.jsx'
import './LanguageSelector.css'

export default function LanguageSelector() {
  const { locale, setLocale } = useLocale()
  return <label className="language-selector" title={t('Language preference')}>
    <i className="fas fa-globe" aria-hidden="true" />
    <span className="sr-only">{t('Language')}</span>
    <select aria-label={t('Language')} value={locale} onChange={event => setLocale(event.target.value)}>
      <option value="en">English</option>
      <option value="tr">Türkçe</option>
    </select>
  </label>
}
