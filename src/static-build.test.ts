import {
  appendFileSync,
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  writeFileSync
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import type { Brease } from './index'
import { build, exportContent, navigationKeys, serve, vercelSource, writeHostOutput } from './static-build'
import { renderTemplate } from './template'
import type { Navigation, Page, Redirect } from './types'

const STARTER = join(__dirname, '..', 'fixtures', 'static-starter')

const seo = (title: string) => ({
  title,
  description: `${title} description`,
  robots: { index: true, follow: true },
  openGraph: {},
  twitter: {},
  structuredData: [],
  alternates: {}
})

const page = (pageId: string, locale: string, slug: string, content: Record<string, unknown>): Page => ({
  pageId,
  name: slug || 'Home',
  locale,
  slug,
  url: '',
  hidden: false,
  content,
  seo: {},
  resolvedSeo: seo(`${slug || 'Home'} ${locale}`),
  alternates: {}
})

const CONTENT: Record<string, Record<string, Page>> = {
  en: {
    '': page('pg_home', 'en', '', {
      hero: {
        title: 'Alpine rooms',
        intro: 'Wake up <b>above</b> the clouds.',
        background: { assetId: 'a1', url: 'https://media.test/bg.jpg' },
        image: { assetId: 'a2', url: 'https://media.test/room.jpg', alt: 'A room', width: 800, height: 600 },
        cta: { label: 'Book now', href: '/book' }
      },
      rooms: [
        { name: 'Single', text: 'For one' },
        { name: 'Double', text: 'For two' }
      ]
    }),
    about: page('pg_about', 'en', 'about', { title: 'About us', body: '<p>Since <em>1890</em>.</p>' }),
    _global: page('pg_global', 'en', '_global', { footer: { copyright: '© Monte 2026' } })
  },
  de: {
    '': page('pg_home', 'de', '', {
      hero: { title: 'Alpenzimmer', intro: 'Über den Wolken.' },
      rooms: [{ name: 'Einzel', text: 'Für eine Person' }]
    }),
    'ueber-uns': page('pg_about', 'de', 'ueber-uns', { title: 'Über uns', body: '<p>Seit 1890.</p>' }),
    _global: page('pg_global', 'de', '_global', { footer: { copyright: '© Monte 2026 (de)' } })
  }
}
const ROUTES = [
  { path: [], slug: '', locale: 'en' },
  { path: ['about'], slug: 'about', locale: 'en' },
  { path: ['de'], slug: '', locale: 'de' },
  { path: ['de', 'ueber-uns'], slug: 'ueber-uns', locale: 'de' }
]
const NAV: Record<string, Navigation> = {
  en: {
    key: 'main',
    locale: 'en',
    items: [
      { id: '1', label: 'Home', url: '/', children: [] },
      { id: '2', label: 'About', url: '/about', children: [] }
    ]
  },
  de: { key: 'main', locale: 'de', items: [{ id: '1', label: 'Start', url: '/de', children: [] }] }
}
const REDIRECTS: Redirect[] = [
  { source: '/about.html', destination: '/about', status: 301 },
  { source: '/blog/:slug', destination: '/news/:slug', status: 308 }
]

const fake = {
  routes: async () => ROUTES.map((r) => ({ path: r.path })),
  route: async (path?: string | string[]) => {
    const joined = (Array.isArray(path) ? path : [path ?? '']).filter(Boolean).join('/')
    const hit = ROUTES.find((r) => r.path.join('/') === joined)
    return hit ? { slug: hit.slug, locale: hit.locale } : null
  },
  getPage: async (slug: string, { locale }: { locale: string }) => CONTENT[locale]?.[slug] ?? null,
  getNavigation: async (key: string, { locale }: { locale: string }) =>
    key === 'main' ? (NAV[locale] ?? null) : null,
  getRedirects: async () => REDIRECTS
} as unknown as Brease

describe('renderTemplate', () => {
  it('fills text, rich text, images, links, lists, menus, site-wide fields and the head', () => {
    const template = readFileSync(join(STARTER, 'templates', 'home.html'), 'utf8')
    const html = renderTemplate(template, {
      page: CONTENT.en?.[''] as Page,
      global: CONTENT.en?._global as Page,
      navigations: { main: NAV.en as Navigation }
    })
    expect(html).toContain('<html lang="en">')
    expect(html).toContain('<title>Home en</title>')
    expect(html).toContain('<h1 data-brease="hero.title">Alpine rooms</h1>')
    expect(html).toContain('Wake up <b>above</b> the clouds.')
    expect(html).toContain('src="https://media.test/room.jpg"')
    expect(html).toContain('alt="A room" width="800" height="600"')
    expect(html).not.toContain('old-2x.jpg')
    expect(html).toContain("background-image: url('https://media.test/bg.jpg')")
    expect(html).toContain('href="/book">Book now</a>')
    expect(html).toContain('<h2 data-brease="rooms.0.name">Single</h2>')
    expect(html).toContain('<h2 data-brease="rooms.1.name">Double</h2>')
    expect(html).toContain('<p data-brease="rooms.1.text">For two</p>')
    expect(html).toContain('<a data-brease-item href="/about">About</a>')
    expect(html).toContain('data-brease="pg_global:footer.copyright">© Monte 2026</p>')
    expect(html).toContain('<script src="/js/app.js" defer></script>')
    expect(html).toContain('class="logo"')
  })

  it('fills a language switcher and marks the current menu item and language', () => {
    const html = renderTemplate(
      '<ul data-brease="nav:main" data-brease-current-class="active"><li data-brease-item><a href="#">x</a></li></ul>' +
        '<ul data-brease="locales" data-brease-current-class="on"><li data-brease-item><a href="#">x</a></li></ul>',
      {
        page: { ...(CONTENT.en?.about as Page), url: 'https://site.test/about/' },
        navigations: { main: NAV.en as Navigation },
        locales: [
          { locale: 'en', label: 'English', href: '/about', current: true },
          { locale: 'de', label: 'Deutsch', href: '/de/ueber-uns', current: false }
        ]
      }
    )
    expect(html).toContain('<li data-brease-item><a href="/">Home</a></li>')
    expect(html).toContain(
      '<li data-brease-item class="active"><a href="/about" aria-current="page">About</a></li>'
    )
    expect(html).toContain(
      '<li data-brease-item class="on"><a href="/about" hreflang="en" lang="en" aria-current="page">English</a></li>'
    )
    expect(html).toContain(
      '<li data-brease-item><a href="/de/ueber-uns" hreflang="de" lang="de">Deutsch</a></li>'
    )
  })

  it('keeps the template where a field has no value, and escapes plain text', () => {
    const html = renderTemplate('<h1 data-brease="missing">Kept</h1><p data-brease="t">x</p>', {
      page: { ...(CONTENT.en?.about as Page), content: { t: 'a < b & c' } }
    })
    expect(html).toBe('<h1 data-brease="missing">Kept</h1><p data-brease="t">a &lt; b &amp; c</p>')
  })
})

describe('brease-client build', () => {
  let out = ''
  afterEach(() => {
    out = ''
  })

  it('renders every page in every locale, copies the site files and writes redirects for the host', async () => {
    const root = mkdtempSync(join(tmpdir(), 'brease-static-'))
    cpSync(STARTER, root, { recursive: true })
    const result = await build(fake, { root, host: 'vercel' })
    out = result.out
    expect(result.pages).toEqual(['/', '/about', '/de', '/de/ueber-uns'])
    const de = readFileSync(join(out, 'de', 'index.html'), 'utf8')
    expect(de).toContain('<html lang="de">')
    expect(de).toContain('Alpenzimmer')
    expect(de).toContain('<a data-brease-item href="/de">Start</a>')
    expect(de).toContain('© Monte 2026 (de)')
    expect(readFileSync(join(out, 'de', 'ueber-uns', 'index.html'), 'utf8')).toContain('<p>Seit 1890.</p>')
    expect(existsSync(join(out, 'css', 'site.css'))).toBe(true)
    expect(existsSync(join(out, 'img', 'logo.svg'))).toBe(true)
    expect(existsSync(join(out, 'templates'))).toBe(false)
    expect(existsSync(join(out, 'package.json'))).toBe(false)
    expect(readFileSync(join(out, '_redirects'), 'utf8')).toBe(
      '/about.html /about 301\n/blog/:slug /news/:slug 308\n'
    )
    const config = JSON.parse(readFileSync(join(root, '.vercel', 'output', 'config.json'), 'utf8'))
    expect(config.routes[0]).toEqual({
      src: '^/about\\.html/?$',
      headers: { Location: '/about' },
      status: 301
    })
    expect(config.routes[1].headers.Location).toBe('/news/$slug')
    expect(existsSync(join(root, '.vercel', 'output', 'static', 'de', 'index.html'))).toBe(true)
  })

  it('publishes only the site files: never secrets, sources or configs of the old site', async () => {
    const root = mkdtempSync(join(tmpdir(), 'brease-static-'))
    cpSync(STARTER, root, { recursive: true })
    const secrets: Record<string, string> = {
      '.env': 'TOKEN=1',
      '.npmrc': '//registry/:_authToken=x',
      '.dev.vars': 'SECRET=1',
      'config.php': '<?php $db = "pw";',
      'hugo.toml': 'baseURL = "/"',
      'content/post.md': '# Draft',
      'gulpfile.js': 'module.exports = {}',
      'img/.hidden.png': 'x',
      'banner.png': 'png',
      'unused.png': 'png'
    }
    for (const [name, body] of Object.entries(secrets)) {
      mkdirSync(join(root, name, '..'), { recursive: true })
      writeFileSync(join(root, name), body)
    }
    appendFileSync(join(root, 'templates', 'home.html'), '<img src="/banner.png">')
    const { out: dist } = await build(fake, { root, host: null })
    for (const name of [
      '.env',
      '.npmrc',
      '.dev.vars',
      'config.php',
      'hugo.toml',
      'content/post.md',
      'gulpfile.js',
      'img/.hidden.png',
      'unused.png'
    ])
      expect(existsSync(join(dist, name)), name).toBe(false)
    expect(existsSync(join(dist, 'banner.png'))).toBe(true)
    expect(existsSync(join(dist, 'css', 'site.css'))).toBe(true)

    const server = serve(fake, { root, port: 0 })
    await new Promise((r) => server.once('listening', r))
    const port = (server.address() as { port: number }).port
    try {
      for (const path of [
        '/.env',
        '/config.php',
        '/hugo.toml',
        '/content/post.md',
        '/gulpfile.js',
        '/unused.png'
      ])
        expect((await fetch(`http://127.0.0.1:${port}${path}`)).status, path).not.toBe(200)
      expect((await fetch(`http://127.0.0.1:${port}/banner.png`)).status).toBe(200)
    } finally {
      server.close()
    }
  })

  it('serves pages rendered per request, the site files and redirects', async () => {
    const server = serve(fake, { root: STARTER, port: 0 })
    await new Promise((r) => server.once('listening', r))
    const port = (server.address() as { port: number }).port
    const get = (path: string) => fetch(`http://127.0.0.1:${port}${path}`, { redirect: 'manual' })
    try {
      expect(await (await get('/de/ueber-uns')).text()).toContain('Über uns')
      expect((await get('/css/site.css')).headers.get('content-type')).toBe('text/css')
      const moved = await get('/about.html')
      expect(moved.status).toBe(301)
      expect(moved.headers.get('location')).toBe('/about')
      expect((await get('/templates/home.html')).status).toBe(404)
      expect((await get('/nope')).status).toBe(404)
    } finally {
      server.close()
    }
  })

  it('reads the menus a template uses and turns redirect sources into Vercel routes', () => {
    expect(navigationKeys('<nav data-brease="nav:main"></nav><ul data-brease="nav:footer">')).toEqual([
      'main',
      'footer'
    ])
    expect(vercelSource('/docs/:rest*')).toBe('/docs/(?<rest>.*)')
  })
})

describe('host output', () => {
  it("keeps the site's own vercel.json rules and serves index.html for unknown paths in an SPA", async () => {
    const root = mkdtempSync(join(tmpdir(), 'brease-host-'))
    const out = join(root, 'dist')
    mkdirSync(out)
    writeFileSync(join(out, 'index.html'), '<html></html>')
    writeFileSync(
      join(root, 'vercel.json'),
      JSON.stringify({
        redirects: [{ source: '/old', destination: '/new', permanent: true }],
        rewrites: [{ source: '/api/:path*', destination: 'https://api.example.com/:path*' }],
        headers: [{ source: '/(.*)', headers: [{ key: 'X-Frame-Options', value: 'DENY' }] }]
      })
    )
    await writeHostOutput(
      [{ source: '/a.html', destination: '/a', status: 301 } as Redirect],
      out,
      'vercel',
      {
        spa: true
      }
    )
    const { routes } = JSON.parse(readFileSync(join(root, '.vercel', 'output', 'config.json'), 'utf8'))
    expect(
      routes.some((r: { headers?: Record<string, string> }) => r.headers?.['X-Frame-Options'] === 'DENY')
    ).toBe(true)
    expect(
      routes.some(
        (r: { status?: number; headers?: { Location?: string } }) =>
          r.status === 308 && r.headers?.Location === '/new'
      )
    ).toBe(true)
    expect(routes.some((r: { headers?: { Location?: string } }) => r.headers?.Location === '/a')).toBe(true)
    const fs = routes.findIndex((r: { handle?: string }) => r.handle === 'filesystem')
    expect(
      routes.findIndex((r: { dest?: string }) => r.dest === 'https://api.example.com/$path')
    ).toBeGreaterThan(fs)
    expect(routes.at(-1)).toEqual({ src: '/(.*)', dest: '/index.html' })
    expect(readFileSync(join(out, '_redirects'), 'utf8')).toContain('/* /index.html 200')
  })
})

describe('brease-client content', () => {
  it('collects every page, menu and the site-wide page per locale for a browser-only app', async () => {
    const brease = {
      ...fake,
      getSite: async () => ({ name: 'Monte', locales: ['en', 'de'], defaultLocale: 'en' }),
      getPages: async ({ locale }: { locale: string }) =>
        Object.values(CONTENT[locale] ?? {})
          .filter((p) => !p.slug.startsWith('_'))
          .map((p) => ({ slug: p.slug }))
    } as unknown as Brease
    const content = await exportContent(brease, ['main'])
    expect(Object.keys(content.pages.de ?? {})).toEqual(['', 'ueber-uns'])
    expect(content.navigations.en?.main?.items).toHaveLength(2)
    expect(content.global.de?.content).toEqual({ footer: { copyright: '© Monte 2026 (de)' } })
    expect(content.redirects).toHaveLength(2)
  })
})
