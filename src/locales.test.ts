import { describe, expect, it } from 'vitest'
import { localeHref, localeLinks, nativeName } from './locales'
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
      localeLinks({
        locale: 'en',
        settings,
        alternates: { hu: '/rolunk', en: '/en/about' },
        homes: { hu: '/', en: '/en' }
      })
    ).toEqual([
      { locale: 'hu', label: 'Magyar', href: '/rolunk', current: false },
      { locale: 'en', label: 'English', href: '/en/about', current: true }
    ])
    expect(
      localeLinks({ locale: 'hu', settings, alternates: { hu: '/kapcsolat' }, homes: { hu: '/', de: '/de' } })
    ).toEqual([
      { locale: 'hu', label: 'Magyar', href: '/kapcsolat', current: true },
      { locale: 'de', label: 'Deutsch', href: '/de', current: false }
    ])
  })

  it('leaves out the locales the page is left out of on purpose, instead of linking their home', () => {
    expect(
      localeLinks({
        locale: 'hu',
        settings,
        alternates: { hu: '/allasok' },
        homes: { hu: '/', en: '/en', de: '/de' },
        excluded: ['en']
      })
    ).toEqual([
      { locale: 'hu', label: 'Magyar', href: '/allasok', current: true },
      { locale: 'de', label: 'Deutsch', href: '/de', current: false }
    ])
  })

  it('names locales in their own language and builds paths', () => {
    expect(nativeName('pt-BR')).toBe('Português (Brasil)')
    expect(localeHref(settings, 'about', 'en')).toBe('/en/about')
    expect(localeHref(settings, '', 'hu')).toBe('/')
  })
})
