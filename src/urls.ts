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

// The home page's slug is empty, so the slug and the separator next to it are optional together.
function customPattern(template: string): RegExp {
  const parts = normalizeSlug(template).split(/(\{locale\}|\{slug\})/)
  const slashBefore = (i: number) => parts[i] === '{slug}' && !!parts[i - 1]?.endsWith('/')
  const slashAfter = (i: number) =>
    parts[i] === '{slug}' && !slashBefore(i) && !!parts[i + 1]?.startsWith('/')
  const pattern = parts
    .map((part, i) => {
      if (part === '{locale}') return '(?<locale>[^/]+)'
      if (part === '{slug}') {
        if (slashBefore(i)) return '(?:/(?<slug>.*))?'
        if (slashAfter(i)) return '(?:(?<slug>.*)/)?'
        return '(?<slug>.*)'
      }
      let text = part
      if (slashBefore(i + 1)) text = text.slice(0, -1)
      if (slashAfter(i - 1)) text = text.slice(1)
      return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    })
    .join('')
  return new RegExp(`^${pattern}$`)
}

export function resolvePath(settings: UrlSettings, pathname: string): { slug: string; locale: string } {
  const clean = normalizeSlug(decodeURIComponent(pathname.split(/[?#]/)[0] ?? ''))
  if (settings.localeStrategy === 'CUSTOM' && settings.urlTemplate) {
    const match = customPattern(settings.urlTemplate).exec(clean)
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

// The one URL a path's page lives at, when `pathname` is another form of it (/en/about where English is the
// unprefixed default, /about where every locale is prefixed); null when it already is the canonical form.
export function canonicalPath(settings: UrlSettings, pathname: string): string | null {
  const path = pathname.split(/[?#]/)[0] ?? ''
  const { slug, locale } = resolvePath(settings, path)
  const canonical = buildPath(settings, slug, locale)
  const trim = (p: string) => (p.length > 1 ? p.replace(/\/+$/, '') : p)
  return trim(decodeURIComponent(path)) === trim(canonical) ? null : canonical
}
