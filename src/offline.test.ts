import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { createBrease } from './index'

// Offline mode reads Brease's content export (brease-seed/) with the API's answers: pages and URLs per locale,
// links to pages, images as files, menus, redirects. No token and no network.
function seed() {
  const dir = mkdtempSync(join(tmpdir(), 'brease-seed-'))
  const w = (path: string, value: unknown) => {
    mkdirSync(join(dir, path, '..'), { recursive: true })
    writeFileSync(join(dir, path), JSON.stringify(value))
  }
  w('site.json', { name: 'Acme', seo: { en: { titleTemplate: '%s · Acme', description: 'Huts' } } })
  w('offline.json', {
    locales: ['en', 'hu'],
    defaultLocale: 'en',
    localeStrategy: 'PREFIX_EXCEPT_DEFAULT',
    urlTemplate: null,
    url: 'https://acme.test'
  })
  w('pages/pg_home/page.json', { name: 'Home', parentId: null, order: 0 })
  w('pages/pg_home/en.json', {
    slug: '',
    content: {
      hero: { image: { $file: 'brease-seed/media/ast_1-a.jpg', alt: 'A hut' } },
      cta: { label: 'About', href: '/about', pageId: 'pg_about' }
    }
  })
  w('pages/pg_home/hu.json', {
    slug: '',
    content: { cta: { label: 'Rólunk', href: '/about', pageId: 'pg_about' } }
  })
  w('pages/pg_about/page.json', { name: 'About', parentId: null, order: 1 })
  w('pages/pg_about/en.json', { slug: 'about', seo: { title: 'About us' }, content: {} })
  w('pages/pg_about/hu.json', { slug: 'rolunk', content: {} })
  w('navigations/main.json', {
    items: [{ id: 'n1', label: { en: 'About', hu: 'Rólunk' }, pageId: 'pg_about' }]
  })
  w('redirects.json', [{ source: '/old', destination: '/about', status: 301 }])
  return dir
}

describe('offline mode', () => {
  it('answers like the API from brease-seed/, without a token', async () => {
    const brease = createBrease({
      offline: { dir: seed(), mediaUrl: 'https://cdn.acme.test' },
      token: undefined
    })
    const site = await brease.getSite()
    expect(site).toMatchObject({
      name: 'Acme',
      locales: ['en', 'hu'],
      defaultLocale: 'en',
      url: 'https://acme.test'
    })

    const home = await brease.getPage<{
      hero: { image: { url: string; alt: string } }
      cta: { href: string }
    }>('', { locale: 'hu' })
    expect(home?.url).toBe('https://acme.test/hu')
    expect(home?.content.cta.href).toBe('/hu/rolunk')
    expect(home?.alternates).toEqual({ en: 'https://acme.test/', hu: 'https://acme.test/hu' })

    const en = await brease.getPage<{ hero: { image: { url: string; alt: string } } }>('', { locale: 'en' })
    expect(en?.content.hero.image).toMatchObject({
      url: 'https://cdn.acme.test/brease-seed/media/ast_1-a.jpg',
      alt: 'A hut'
    })

    const about = await brease.getPage('about', { locale: 'en' })
    expect(about?.resolvedSeo.title).toBe('About us · Acme')
    expect(about?.resolvedSeo.description).toBe('Huts')
    expect(await brease.getPage('missing', { locale: 'en' })).toBeNull()

    expect((await brease.getPages({ locale: 'hu' })).map((p) => p.slug).sort()).toEqual(['', 'rolunk'])
    expect((await brease.getNavigation('main', { locale: 'hu' }))?.items[0]).toMatchObject({
      label: 'Rólunk',
      url: '/hu/rolunk'
    })
    expect(await brease.getRedirects()).toEqual([{ source: '/old', destination: '/about', status: 301 }])
    expect(await brease.route(['hu', 'rolunk'])).toEqual({ slug: 'rolunk', locale: 'hu' })
  })
})
