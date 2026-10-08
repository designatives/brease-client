import type { LocaleContext } from './index'
import type { UrlSettings } from './types'
import { buildPath } from './urls'

export type LocaleLink = { locale: string; label: string; href: string; current: boolean }

// What a locale switcher shows, in any framework: one link per locale that has content, to the same page
// there, else to that locale's home page. A locale with neither (added, not translated yet) is left out.
export function localeLinks(context: LocaleContext): LocaleLink[] {
  const { settings, alternates, homes, locale: current } = context
  return settings.locales.flatMap((l) => {
    const href = alternates[l] ?? homes[l] ?? (l === current ? buildPath(settings, '', l) : null)
    return href ? [{ locale: l, label: nativeName(l), href, current: l === current }] : []
  })
}

// A locale's name in its own language: hu → Magyar, de → Deutsch, pt-BR → Português (Brasil).
export function nativeName(locale: string) {
  try {
    const name = new Intl.DisplayNames([locale], { type: 'language' }).of(locale) ?? locale
    return name.charAt(0).toLocaleUpperCase(locale) + name.slice(1)
  } catch {
    return locale
  }
}

// A page's path from its slug in a locale: localeHref(settings, 'about', 'en') → /en/about.
export const localeHref = (settings: UrlSettings, slug: string, locale: string) =>
  buildPath(settings, slug, locale)
