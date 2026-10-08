import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { BreaseLocaleProvider, LocaleSwitcher, localeLinks, nativeName } from './react'
import type { UrlSettings } from './types'

const settings: UrlSettings = {
  locales: ['hu', 'en', 'de'],
  defaultLocale: 'hu',
  localeStrategy: 'PREFIX_EXCEPT_DEFAULT',
  urlTemplate: null
}

describe('locale links', () => {
  it('links the same page in each locale, else that locale’s home, and skips locales without content', () => {
    expect(
      localeLinks(
        settings,
        { alternates: { hu: '/rolunk', en: '/en/about' }, homes: { hu: '/', en: '/en' } },
        'en'
      )
    ).toEqual([
      { locale: 'hu', label: 'Magyar', href: '/rolunk', current: false },
      { locale: 'en', label: 'English', href: '/en/about', current: true }
    ])
    expect(
      localeLinks(settings, { alternates: { hu: '/kapcsolat' }, homes: { hu: '/', de: '/de' } }, 'hu')
    ).toEqual([
      { locale: 'hu', label: 'Magyar', href: '/kapcsolat', current: true },
      { locale: 'de', label: 'Deutsch', href: '/de', current: false }
    ])
    expect(nativeName('pt-BR')).toBe('Português (Brasil)')
  })

  it('renders an unstyled switcher, and nothing for a single locale', () => {
    const html = renderToStaticMarkup(
      <BreaseLocaleProvider
        value={{
          locale: 'hu',
          settings,
          alternates: { hu: '/', en: '/en' },
          homes: { hu: '/', en: '/en', de: '/de' }
        }}
      >
        <LocaleSwitcher className="langs" />
      </BreaseLocaleProvider>
    )
    expect(html).toContain('<nav aria-label="Language" class="langs">')
    expect(html).toContain('<a href="/" hrefLang="hu" lang="hu" aria-current="page">Magyar</a>')
    expect(html).toContain('<a href="/de" hrefLang="de" lang="de">Deutsch</a>')
    const single = renderToStaticMarkup(
      <BreaseLocaleProvider
        value={{ locale: 'hu', settings: { ...settings, locales: ['hu'] }, alternates: {}, homes: {} }}
      >
        <LocaleSwitcher />
      </BreaseLocaleProvider>
    )
    expect(single).toBe('')
  })
})
