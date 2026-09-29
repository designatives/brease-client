import type { UrlSettings } from './types'

// Must match how Brease builds page URLs; copied here so the client has no runtime deps.
export function normalizeSlug(input: string): string {
  return input
    .trim()
    .replace(/^\/+|\/+$/g, '')
    .replace(/\/{2,}/g, '/')
}

export function buildPath(settings: UrlSettings, slug: string, locale: string): string {
  const clean = normalizeSlug(slug)
  if (settings.localeStrategy === 'CUSTOM' && settings.urlTemplate) {
    const path = settings.urlTemplate.replace('{locale}', locale).replace('{slug}', clean)
    return `/${normalizeSlug(path)}`
  }
  const prefixed = settings.localeStrategy === 'PREFIX_ALL' || locale !== settings.defaultLocale
  const parts = [prefixed ? locale : '', clean].filter(Boolean)
  return `/${parts.join('/')}`
}

export function resolvePath(settings: UrlSettings, pathname: string): { slug: string; locale: string } {
  const clean = normalizeSlug(decodeURIComponent(pathname.split(/[?#]/)[0] ?? ''))
  if (settings.localeStrategy === 'CUSTOM' && settings.urlTemplate) {
    const pattern = normalizeSlug(settings.urlTemplate)
      .split(/(\{locale\}|\{slug\})/)
      .map((part) => {
        if (part === '{locale}') return '(?<locale>[^/]+)'
        if (part === '{slug}') return '(?<slug>.*)'
        return part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
      })
      .join('')
    const match = new RegExp(`^${pattern}$`).exec(clean)
    if (match?.groups) {
      return {
        slug: normalizeSlug(match.groups.slug ?? ''),
        locale: match.groups.locale ?? settings.defaultLocale
      }
    }
    return { slug: clean, locale: settings.defaultLocale }
  }
  const [first, ...rest] = clean.split('/')
  if (first && settings.locales.includes(first)) {
    return { slug: rest.join('/'), locale: first }
  }
  return { slug: clean, locale: settings.defaultLocale }
}
