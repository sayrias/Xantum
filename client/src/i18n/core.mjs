import uiEnglish from './en.json' with { type: 'json' }
import backendEnglish from '../../shared/backend-messages.json' with { type: 'json' }
const english = { ...backendEnglish, ...uiEnglish }

export const LOCALES = Object.freeze(['en', 'tr'])
export const STORAGE_KEY = 'xantum_locale'
const turkishOverrides = {
  'Language': 'Dil', 'Language preference': 'Dil tercihi',
  'Changes apply immediately.': 'Değişiklikler anında uygulanır.',
}
const reverseEnglish = new Map(Object.entries(english).map(([key, value]) => [value, key.endsWith('_one') ? key.slice(0, -4) : key]))
const patterns = Object.entries(english).filter(([key]) => /\{\w+\}/.test(key)).map(([source, translated]) => {
  const compile = template => {
    const names = []
    const escaped = template.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\\\{(\w+)\\\}/g, (_, name) => { names.push(name); return '(.+?)' })
    return { expression: new RegExp('^' + escaped + '$', 's'), names }
  }
  return { source, versions: [compile(source), compile(translated)] }
})
export const normalizeLocale = value => LOCALES.includes(value) ? value : 'en'
function savedLocale() {
  try { return normalizeLocale(globalThis.localStorage?.getItem(STORAGE_KEY)) } catch { return 'en' }
}
let locale = savedLocale()
let revision = 0
let pendingDesktop = 0
const listeners = new Set()
export const getLocale = () => locale
export const subscribe = callback => { listeners.add(callback); return () => listeners.delete(callback) }
export const intlLocale = value => normalizeLocale(value) === 'tr' ? 'tr-TR' : 'en-US'

export function translate(key, values = {}, language = locale) {
  if (typeof key !== 'string') return key ?? ''
  const leading = key.match(/^\s*/)[0], trailing = key.match(/\s*$/)[0]
  const original = key.trim()
  let source = Object.hasOwn(english, original) ? original : reverseEnglish.get(original)
  if (!source) {
    for (const pattern of patterns) {
      for (const version of pattern.versions) {
        const matched = version.expression.exec(original)
        if (matched) { source = pattern.source; values = { ...Object.fromEntries(version.names.map((name, i) => [name, matched[i + 1]])), ...values }; break }
      }
      if (source) break
    }
  }
  source ||= original
  const singular = values.count === 1 && Object.hasOwn(english, source + '_one')
  const template = normalizeLocale(language) === 'tr'
    ? turkishOverrides[source] || source
    : english[singular ? source + '_one' : source] || source
  return leading + template.replace(/\{(\w+)\}/g, (match, name) => Object.hasOwn(values, name) ? String(values[name]) : match) + trailing
}
export const t = translate
function publish(value) {
  locale = normalizeLocale(value)
  try { globalThis.localStorage?.setItem(STORAGE_KEY, locale) } catch {}
  if (globalThis.document) document.documentElement.lang = locale
  for (const callback of listeners) callback()
}
export function setLocale(value, { syncDesktop = true } = {}) {
  if (!LOCALES.includes(value)) return false
  revision++
  publish(value)
  if (syncDesktop) {
    const request = revision
    pendingDesktop = request
    try { Promise.resolve(globalThis.window?.electronAPI?.locale?.set(value)).catch(() => {}).finally(() => { if (pendingDesktop === request) pendingDesktop = 0 }) }
    catch { pendingDesktop = 0 }
  }
  return true
}
export function connectDesktopLocale() {
  const api = globalThis.window?.electronAPI?.locale
  const started = revision
  try {
    Promise.resolve(api?.get()).then(result => {
      if (revision === started && LOCALES.includes(result?.locale)) publish(result.locale)
    }).catch(() => {})
  } catch {}
  const unsubscribe = api?.onChange?.(result => {
    if (LOCALES.includes(result?.locale) && (!pendingDesktop || result.locale === locale)) publish(result.locale)
  })
  return typeof unsubscribe === 'function' ? unsubscribe : () => {}
}
if (globalThis.document) document.documentElement.lang = locale
