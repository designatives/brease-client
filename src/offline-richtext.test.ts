import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { createBrease } from './index'

// Rich text in an export: images named brease-file:<path> and links to pages by data-brease-page (AUD-41).
function seed() {
  const dir = mkdtempSync(join(tmpdir(), 'brease-seed-rt-'))
  const w = (path: string, value: unknown) => {
    mkdirSync(join(dir, path, '..'), { recursive: true })
    writeFileSync(join(dir, path), JSON.stringify(value))
  }
  w('site.json', { name: 'Acme', seo: {} })
  w('offline.json', {
    locales: ['en', 'hu'],
    defaultLocale: 'en',
    localeStrategy: 'PREFIX_EXCEPT_DEFAULT',
    urlTemplate: null,
    url: 'https://acme.vercel.app'
  })
  w('pages/pg_home/page.json', { name: 'Home', parentId: null, order: 0 })
  w('pages/pg_home/hu.json', {
    slug: '',
    content: {
      body: '<p><img src="brease-file:brease-seed/media/ast_2-b.png" alt=""> <a data-brease-page="pg_about" href="/about">Rólunk</a> <a data-brease-page="pg_gone" href="/x">X</a></p>'
    }
  })
  w('pages/pg_home/en.json', { slug: '', content: {} })
  w('pages/pg_about/page.json', { name: 'About', parentId: null, order: 1 })
  w('pages/pg_about/en.json', { slug: 'about', content: {} })
  w('pages/pg_about/hu.json', { slug: 'rolunk', content: {} })
  w('redirects.json', [])
  return dir
}

describe('offline mode, rich text', () => {
  it('turns exported media into file URLs and page links into the locale URL', async () => {
    const brease = createBrease({ offline: { dir: seed(), mediaUrl: '/files' }, token: undefined })
    const home = await brease.getPage<{ body: string }>('', { locale: 'hu' })
    expect(home?.content.body).toContain('src="/files/brease-seed/media/ast_2-b.png"')
    expect(home?.content.body).toContain('<a data-brease-page="pg_about" href="/hu/rolunk">Rólunk</a>')
    expect(home?.content.body).toContain('<a data-brease-page="pg_gone" href="/x">X</a>')
    expect(home?.url).toBe('https://acme.vercel.app/hu')
  })
})
