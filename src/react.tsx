import { createContext, type ReactNode, useContext } from 'react'
import type { LocaleContext } from './index'
import type { UrlSettings } from './types'
import { buildPath } from './urls'

// Client components' view of the current locale. Wrap the page in BreaseLocaleProvider with the value of
// brease.localeContext() (usually in the root layout), then read it with useLocale().

const Context = createContext<LocaleContext | null>(null)

export function BreaseLocaleProvider({ value, children }: { value: LocaleContext; children: ReactNode }) {
  return <Context.Provider value={value}>{children}</Context.Provider>
}

export type LocaleInfo = LocaleContext & {
  locales: string[]
  // A page's path from its slug, in this locale or another: href('rolunk') → /rolunk, href('about', 'en') → /en/about.
  href: (slug: string, locale?: string) => string
}

export function useLocale(): LocaleInfo {
  const value = useContext(Context)
  if (!value) throw new Error('useLocale() needs a <BreaseLocaleProvider> above it')
  return {
    ...value,
    locales: value.settings.locales,
    href: (slug, locale = value.locale) => buildPath(value.settings, slug, locale)
  }
}

export type LocaleLink = { locale: string; label: string; href: string; current: boolean }

// One link per locale that has content: the same page there, or that locale's home page when the page has no
// version in it. A locale with neither (added but not translated yet) is left out.
export function useLocaleLinks(): LocaleLink[] {
  const { locale, settings, alternates, homes } = useLocale()
  return localeLinks(settings, { alternates, homes }, locale)
}

export function localeLinks(
  settings: UrlSettings,
  paths: Pick<LocaleContext, 'alternates' | 'homes'>,
  current: string
): LocaleLink[] {
  return settings.locales.flatMap((l) => {
    const href = paths.alternates[l] ?? paths.homes[l] ?? (l === current ? buildPath(settings, '', l) : null)
    return href ? [{ locale: l, label: nativeName(l), href, current: l === current }] : []
  })
}

export function nativeName(locale: string) {
  try {
    const name = new Intl.DisplayNames([locale], { type: 'language' }).of(locale) ?? locale
    return name.charAt(0).toLocaleUpperCase(locale) + name.slice(1)
  } catch {
    return locale
  }
}

// An unstyled locale selector: a list of links, the current one marked with aria-current. Renders nothing
// while the site has one locale. For custom markup, use useLocaleLinks() instead.
export function LocaleSwitcher({
  className,
  linkClassName,
  label = 'Language'
}: {
  className?: string
  linkClassName?: string
  label?: string
}) {
  const links = useLocaleLinks()
  if (links.length < 2) return null
  return (
    <nav aria-label={label} className={className}>
      {links.map((l) => (
        <a
          key={l.locale}
          href={l.href}
          hrefLang={l.locale}
          lang={l.locale}
          aria-current={l.current ? 'page' : undefined}
          className={linkClassName}
        >
          {l.label}
        </a>
      ))}
    </nav>
  )
}
