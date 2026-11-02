import { useSyncExternalStore } from 'react'
import { getLocale, subscribe, setLocale, intlLocale } from './core.mjs'
export { t, setLocale, connectDesktopLocale } from './core.mjs'
export function useLocale() {
  const locale = useSyncExternalStore(subscribe, getLocale, () => 'en')
  return { locale, setLocale, numberLocale: intlLocale(locale) }
}
