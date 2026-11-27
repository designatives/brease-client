import { cpSync, mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { Brease } from './index'
import { build } from './static-build'
import type { Navigation, Page } from './types'

const STARTER = join(__dirname, '..', 'fixtures', 'static-starter')

const page = (locale: string, slug: string, content: Record<string, unknown>): Page => ({
  pageId: `pg_${slug || 'home'}`,
  name: slug || 'Home',
  locale,
  slug,
  url: '',
  hidden: false,
  content,
  seo: {},
  resolvedSeo: {
    title: slug || 'Home',
    description: '',
    robots: { index: true, follow: true },
    openGraph: {},
    twitter: {},
    structuredData: [],
    alternates: {}
  },
  alternates: {}
})

describe('brease-client build, many pages', () => {
  it('renders pages a few at a time, keeps their order and reads each navigation and _global once', async () => {
    const slugs = Array.from({ length: 20 }, (_, i) => `p${i}`)
    let inFlight = 0
    let peak = 0
    const counts = { nav: 0, global: 0 }
    const slow = async <T>(value: T) => {
      inFlight++
      peak = Math.max(peak, inFlight)
      await new Promise((r) => setTimeout(r, 5))
      inFlight--
      return value
    }
    const nav: Navigation = { key: 'main', locale: 'en', items: [] }
    const fake = {
      routes: async () => slugs.map((s) => ({ path: [s] })),
      route: async (path: string[]) => ({ slug: path.join('/'), locale: 'en' }),
      getPage: async (slug: string, { locale }: { locale: string }) => {
        if (slug === '_global') {
          counts.global++
          return slow(page(locale, '_global', { footer: { copyright: '© Test' } }))
        }
        return slow(page(locale, slug, { title: slug, body: `<p>${slug}</p>` }))
      },
      getNavigation: async () => {
        counts.nav++
        return slow(nav)
      },
      getRedirects: async () => []
    } as unknown as Brease

    const root = mkdtempSync(join(tmpdir(), 'brease-static-par-'))
    cpSync(STARTER, root, { recursive: true })
    const result = await build(fake, { root, host: null })
    expect(result.pages).toEqual(slugs.map((s) => `/${s}`))
    expect(readFileSync(join(result.out, 'p7', 'index.html'), 'utf8')).toContain('<p>p7</p>')
    expect(peak).toBeGreaterThan(1)
    expect(peak).toBeLessThanOrEqual(12)
    expect(counts.nav).toBeLessThanOrEqual(1)
    expect(counts.global).toBeLessThanOrEqual(1)
  })
})
