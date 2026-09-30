import { beforeEach, describe, expect, it, vi } from 'vitest'
import { breaseHead } from './astro'
import { headTagList, headTags } from './html'
import { imageProps, imageUrl, srcset } from './image'
import { hmacHex, revalidateHandler, toMetadata } from './next'
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
