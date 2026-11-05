import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ga4Html, ga4Tag, grantAnalytics } from './analytics'
import { breaseHead } from './astro'
import { customTags } from './custom-code'
import { headTagList, headTags } from './html'
import { imageProps, imageUrl, srcset } from './image'
import { fieldPath, navPath } from './markers'
import { hmacHex, revalidateHandler, toMetadata } from './next'
import { matchRedirect } from './redirects'
import { checkSections, sectionAttrs } from './sections'
import { verifyRevalidate } from './signature'
import { jsonLd, jsonLdHtml } from './structured-data'
import type { ResolvedSeo } from './types'

const cache = vi.hoisted(() => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn() }))
vi.mock('next/cache', () => cache)

const seo: ResolvedSeo = {
  title: 'About us | Fixture',
  description: 'Meet "the" team <3',
  canonical: 'https://example.com/en/about',
  robots: { index: true, follow: false },
  openGraph: {
    type: 'website',
    title: 'About us | Fixture',
    description: 'Meet the team',
    image: 'https://cdn.test/og.png',
    url: 'https://example.com/en/about',
    siteName: 'Fixture'
  },
  twitter: { card: 'summary_large_image', title: 'About us | Fixture', image: 'https://cdn.test/og.png' },
  structuredData: [{ '@type': 'Organization', name: '</script><script>alert(1)</script>' }],
  alternates: { hu: 'https://example.com/rolunk', en: 'https://example.com/en/about' },
  customHead: '<meta name="custom" content="1">',
  favicon: '/favicon.ico'
}

describe('toMetadata', () => {
  it('maps resolved SEO to Next metadata', () => {
    expect(toMetadata(seo, { xDefault: 'https://example.com/rolunk' })).toEqual({
      title: { absolute: 'About us | Fixture' },
      description: 'Meet "the" team <3',
      alternates: {
        canonical: 'https://example.com/en/about',
        languages: { ...seo.alternates, 'x-default': 'https://example.com/rolunk' }
      },
      robots: { index: true, follow: false },
      openGraph: {
        type: 'website',
        title: 'About us | Fixture',
        description: 'Meet the team',
        url: 'https://example.com/en/about',
        siteName: 'Fixture',
        images: [{ url: 'https://cdn.test/og.png' }]
      },
      twitter: {
        card: 'summary_large_image',
        title: 'About us | Fixture',
        images: ['https://cdn.test/og.png']
      },
      icons: { icon: '/favicon.ico' }
    })
  })
})

describe('revalidateHandler', () => {
  const secret = 'shh'
  const signed = async (body: string, ts = Date.now(), key = secret) =>
    new Request('https://site.test/api/revalidate', {
      method: 'POST',
      body,
      headers: {
        'x-brease-timestamp': String(ts),
        'x-brease-signature': await hmacHex(key, `${ts}.${body}`)
      }
    })

  beforeEach(() => {
    cache.revalidatePath.mockClear()
    cache.revalidateTag.mockClear()
  })

  it('revalidates paths and tags for a valid signature', async () => {
    const body = JSON.stringify({
      urls: ['https://example.com/en/about?x=1'],
      paths: ['/'],
      tags: ['page:1']
    })
    const res = await revalidateHandler(secret)(await signed(body))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({
      revalidated: true,
      paths: ['/', '/en/about'],
      tags: ['brease', 'page:1']
    })
    expect(cache.revalidatePath.mock.calls.map((c) => c[0])).toEqual(['/', '/en/about'])
    expect(cache.revalidateTag.mock.calls.map((c) => c[0])).toEqual(['brease', 'page:1'])
  })

  it('rejects bad and expired signatures', async () => {
    const handler = revalidateHandler(secret)
    expect((await handler(await signed('{}', Date.now(), 'wrong'))).status).toBe(401)
    expect((await handler(await signed('{}', Date.now() - 10 * 60_000))).status).toBe(401)
    expect((await handler(new Request('https://x.test', { method: 'POST', body: '{}' }))).status).toBe(401)
    expect(cache.revalidateTag).not.toHaveBeenCalled()
  })

  it('returns 400 on invalid JSON', async () => {
    expect((await revalidateHandler(secret)(await signed('not json'))).status).toBe(400)
  })
})

describe('head tags', () => {
  it('escapes attributes and JSON-LD', () => {
    const html = headTags(seo, { xDefault: 'https://example.com/rolunk' })
    expect(html).toContain('<title>About us | Fixture</title>')
    expect(html).toContain('<meta name="description" content="Meet &quot;the&quot; team &lt;3">')
    expect(html).toContain('<meta name="robots" content="index, nofollow">')
    expect(html).toContain('<link rel="alternate" hreflang="x-default" href="https://example.com/rolunk">')
    expect(html).toContain('<meta property="og:image" content="https://cdn.test/og.png">')
    expect(html).not.toContain('</script><script>alert')
    expect(html).toContain('\\u003c/script>')
    expect(html).toContain('<meta name="custom" content="1">')
    expect(headTags(seo, { includeCustom: false })).not.toContain('custom')
    expect(breaseHead(seo)).toBe(headTags(seo))
    expect(headTagList(seo)[0]).toEqual({ tag: 'title', attrs: {}, content: 'About us | Fixture' })
  })
})

describe('image', () => {
  it('passes bucket URLs through, leaving resizing to the site', () => {
    const src = 'https://bucket.fsn1.your-objectstorage.com/site_1/ast_1/hero.jpg'
    expect(imageUrl(src, { width: 640 })).toBe(src)
    expect(srcset(src)).toBe('')
    expect(imageProps(src, { sizes: '50vw' })).toEqual({ src, srcSet: '', sizes: '50vw' })
  })
})

describe('sections', () => {
  it('gives the section markers', () => {
    expect(sectionAttrs({ id: 'sec_1', type: 'hero' })).toEqual({
      'data-brease-section': 'sec_1',
      'data-brease-block': 'hero'
    })
  })

  it('warns about the folder, the map and the content', () => {
    const files = {
      'src/brease/sections/index.tsx': 'export const map = { hero: Hero } // <div {...sectionAttrs(s)}>',
      'src/brease/sections/hero/section.json': '{"name":"Hero","fields":{"type":"object"}}',
      'src/brease/sections/faq/section.json': '{"fields":{}}',
      'src/brease/sections/Bad/x.tsx': ''
    }
    const pages = {
      pg_home: {
        en: {
          content: {
            sections: [
              { id: 'a', type: 'hero' },
              { id: 'b', type: 'gone' }
            ]
          }
        },
        de: { content: { sections: [{ id: 'a', type: 'hero' }] } }
      }
    }
    expect(checkSections(files, pages)).toEqual([
      'src/brease/sections/faq/section.json has no name',
      'faq is in src/brease/sections but not in its map file',
      'src/brease/sections/Bad: use lowercase letters, numbers and - in section folder names',
      'pg_home (en): section type "gone" has no folder',
      'pg_home: the sections in de differ from the other locales'
    ])
  })
})

describe('ga4 tag', () => {
  it('renders nothing when the tag is off or invalid', () => {
    expect(ga4Tag({ analytics: null })).toBeNull()
    expect(ga4Tag({})).toBeNull()
    expect(ga4Tag({ analytics: { ga4: "G-1');alert(1)//" } })).toBeNull()
    expect(ga4Html({ analytics: null })).toBe('')
  })

  it('starts with consent denied and configures the measurement id', () => {
    const tag = ga4Tag({ analytics: { ga4: 'G-ABC123' } })
    expect(tag?.src).toBe('https://www.googletagmanager.com/gtag/js?id=G-ABC123')
    expect(tag?.inline).toContain("analytics_storage:'denied'")
    expect(tag?.inline).toContain("gtag('config','G-ABC123')")
    expect(ga4Html({ analytics: { ga4: 'G-ABC123' } })).toContain('<script async src=')
  })

  it('updates consent through gtag', () => {
    const gtag = vi.fn()
    ;(globalThis as { gtag?: unknown }).gtag = gtag
    grantAnalytics()
    expect(gtag).toHaveBeenCalledWith('consent', 'update', { analytics_storage: 'granted' })
    delete (globalThis as { gtag?: unknown }).gtag
  })
})

describe('jsonLd', () => {
  it('returns each item with escaped JSON', () => {
    const [item] = jsonLd(seo)
    expect(item?.data).toEqual(seo.structuredData[0])
    expect(item?.json).not.toContain('</script>')
    expect(JSON.parse(item?.json ?? '')).toEqual(seo.structuredData[0])
    expect(jsonLd({ structuredData: [] })).toEqual([])
  })

  it('renders script tags for HTML pages', () => {
    expect(jsonLdHtml(seo)).toMatch(/^<script type="application\/ld\+json">\{"@type":"Organization"/)
    expect(jsonLdHtml({ structuredData: [] })).toBe('')
  })
})

describe('redirects per request', () => {
  const redirects = [
    { source: '/old', destination: '/new', status: 301 as const },
    { source: '/blog/:slug', destination: '/news/:slug', status: 308 as const },
    { source: '/docs/:rest*', destination: 'https://docs.example.com/:rest', status: 302 as const },
    { source: '/loop', destination: '/loop', status: 301 as const }
  ]
  it('matches exact paths, parameters and the rest of a path', () => {
    expect(matchRedirect(redirects, '/old/')).toEqual({ destination: '/new', status: 301 })
    expect(matchRedirect(redirects, '/blog/hello')).toEqual({ destination: '/news/hello', status: 308 })
    expect(matchRedirect(redirects, '/docs/a/b')).toEqual({
      destination: 'https://docs.example.com/a/b',
      status: 302
    })
    expect(matchRedirect(redirects, '/blog/a/b')).toBeNull()
    expect(matchRedirect(redirects, '/loop')).toBeNull()
    expect(matchRedirect(redirects, '/elsewhere')).toBeNull()
  })
})

describe('editor markers', () => {
  it('prefix fields of another page with its id, and menus with nav:', () => {
    expect(fieldPath('hero.title')).toBe('hero.title')
    expect(fieldPath('footer.copyright', 'pg_01abc')).toBe('pg_01abc:footer.copyright')
    expect(navPath('main')).toBe('nav:main')
  })
})

describe('custom code', () => {
  it('becomes tags a framework renders as real elements', () => {
    const tags = customTags({
      customHead: '<meta name="x" content="1"><script src="https://a.example/t.js" async></script>',
      customCode: '<style>.a{}</style><div>ignored</div><script>window.ok = 1</script>'
    })
    expect(tags).toEqual([
      { tag: 'meta', attrs: { name: 'x', content: '1' } },
      { tag: 'script', attrs: { src: 'https://a.example/t.js', async: '' } },
      { tag: 'style', attrs: {}, content: '.a{}' },
      { tag: 'script', attrs: {}, content: 'window.ok = 1' }
    ])
    expect(customTags({})).toEqual([])
  })
})

describe('refresh requests in any framework', () => {
  it('verifies the signature and lists what to refresh', async () => {
    const key = 'secret'
    const body = JSON.stringify({ urls: ['https://site.example/en/about'], tags: ['site:1'] })
    const ts = String(Date.now())
    const req = (signature: string) => ({
      text: async () => body,
      headers: {
        get: (n: string) => (n === 'x-brease-timestamp' ? ts : n === 'x-brease-signature' ? signature : null)
      }
    })
    expect(await verifyRevalidate(req(await hmacHex(key, `${ts}.${body}`)), key)).toMatchObject({
      paths: ['/en/about'],
      tags: ['brease', 'site:1']
    })
    expect(await verifyRevalidate(req('bad'), key)).toEqual({ ok: false, reason: 'signature' })
  })
})

describe('image fields', () => {
  it('take the url, alt text and size from an image object', () => {
    expect(
      imageProps({ assetId: 'ast_1', url: 'https://cdn.example/a.jpg', alt: 'A', width: 800, height: 600 })
    ).toEqual({
      src: 'https://cdn.example/a.jpg',
      srcSet: '',
      sizes: '100vw',
      alt: 'A',
      width: 800,
      height: 600
    })
  })
})
