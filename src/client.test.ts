import { afterEach, describe, expect, it, vi } from 'vitest'
import { BreaseError, createBrease } from './index'
import type { PageRef, Site } from './types'

type Call = { url: string; headers: Record<string, string> }

function mockFetch(responses: (Response | Error)[]) {
  const calls: Call[] = []
  const fn = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), headers: (init?.headers ?? {}) as Record<string, string> })
    const next = responses.shift()
    if (!next) throw new Error('no more responses')
    if (next instanceof Error) throw next
    return next
  })
  return { fetch: fn as unknown as typeof fetch, calls }
}

const json = (data: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json', ...headers } })

const site: Site = {
  name: 'Fixture',
  locales: ['hu', 'en'],
  defaultLocale: 'hu',
  localeStrategy: 'PREFIX_EXCEPT_DEFAULT',
  urlTemplate: null,
  seo: {}
}

afterEach(() => {
  vi.unstubAllEnvs()
})

describe('createBrease', () => {
  it('calls every route with auth and commit headers', async () => {
    const { fetch, calls } = mockFetch([json(site), json([]), json({}), json({}), json([]), json({})])
    const b = createBrease({ token: 'brs_live_x', apiUrl: 'https://api.test/', commit: 'abc123', fetch })
    await b.getSite()
    await b.getPages({ locale: 'en' })
    await b.getPage('about', { locale: 'en' })
    await b.getNavigation('main', { locale: 'hu' })
    await b.getRedirects()
    await b.getRelease()
    expect(calls.map((c) => c.url)).toEqual([
      'https://api.test/content-api/site',
      'https://api.test/content-api/pages?locale=en',
      'https://api.test/content-api/page?slug=about&locale=en',
      'https://api.test/content-api/navigations/main?locale=hu',
      'https://api.test/content-api/redirects',
      'https://api.test/content-api/release'
    ])
    expect(calls[0]?.headers).toEqual({
      authorization: 'Bearer brs_live_x',
      accept: 'application/json',
      'x-brease-commit': 'abc123'
    })
  })

  it('pins the commit from VERCEL_GIT_COMMIT_SHA unless disabled', async () => {
    vi.stubEnv('VERCEL_GIT_COMMIT_SHA', 'deadbeef')
    vi.stubEnv('BREASE_TOKEN', 'env-token')
    vi.stubEnv('BREASE_API_URL', 'http://localhost:4100')
    const a = mockFetch([json([])])
    await createBrease({ fetch: a.fetch }).getRedirects()
    expect(a.calls[0]?.url).toBe('http://localhost:4100/content-api/redirects')
    expect(a.calls[0]?.headers['x-brease-commit']).toBe('deadbeef')
    expect(a.calls[0]?.headers.authorization).toBe('Bearer env-token')
    const b = mockFetch([json([])])
    await createBrease({ fetch: b.fetch, commit: false }).getRedirects()
    expect(b.calls[0]?.headers['x-brease-commit']).toBeUndefined()
  })

  it('returns null on 404 for pages and navigations', async () => {
    const notFound = () => json({ error: { code: 'not_found', message: 'nope' } }, 404)
    const { fetch } = mockFetch([notFound(), notFound()])
    const b = createBrease({ token: 't', fetch })
    expect(await b.getPage('missing', { locale: 'hu' })).toBeNull()
    expect(await b.getNavigation('missing', { locale: 'hu' })).toBeNull()
  })

  it('throws a typed BreaseError without retrying on 4xx', async () => {
    const { fetch, calls } = mockFetch([
      json({ error: { code: 'unauthorized', message: 'Bad token' } }, 401, { 'x-request-id': 'req_1' })
    ])
    const err = await createBrease({ token: 't', fetch })
      .getSite()
      .catch((e) => e)
    expect(err).toBeInstanceOf(BreaseError)
    expect(err).toMatchObject({ code: 'unauthorized', status: 401, requestId: 'req_1', message: 'Bad token' })
    expect(calls).toHaveLength(1)
  })

  it('throws when no token is available', async () => {
    const { fetch } = mockFetch([])
    await expect(createBrease({ fetch }).getSite()).rejects.toMatchObject({ code: 'unauthorized' })
  })

  it('retries 5xx, 429 and network errors, then succeeds', async () => {
    const { fetch, calls } = mockFetch([json({}, 503), json({}, 429, { 'retry-after': '0' }), json([])])
    expect(await createBrease({ token: 't', fetch, retryBaseMs: 1 }).getRedirects()).toEqual([])
    expect(calls).toHaveLength(3)
    const net = mockFetch([new TypeError('fetch failed'), json([])])
    expect(await createBrease({ token: 't', fetch: net.fetch, retryBaseMs: 1 }).getRedirects()).toEqual([])
  })

  it('gives up after two retries', async () => {
    const { fetch, calls } = mockFetch([json({}, 500), json({}, 502), json({}, 503)])
    await expect(createBrease({ token: 't', fetch, retryBaseMs: 1 }).getRedirects()).rejects.toMatchObject({
      status: 503,
      code: 'upstream'
    })
    expect(calls).toHaveLength(3)
  })
})

describe('resolve', () => {
  const resolveWith = async (s: Site, path: string) => {
    const { fetch, calls } = mockFetch([json(s)])
    const b = createBrease({ token: 't', fetch })
    const first = await b.resolve(path)
    await b.resolve('/')
    expect(calls).toHaveLength(1)
    return first
  }

  it('uses the site locale strategy', async () => {
    expect(await resolveWith(site, '/en/about')).toEqual({ slug: 'about', locale: 'en' })
    expect(await resolveWith(site, '/rolunk/')).toEqual({ slug: 'rolunk', locale: 'hu' })
    expect(await resolveWith({ ...site, localeStrategy: 'PREFIX_ALL' }, '/hu/rolunk')).toEqual({
      slug: 'rolunk',
      locale: 'hu'
    })
    const custom: Site = { ...site, localeStrategy: 'CUSTOM', urlTemplate: '/site/{locale}/{slug}' }
    expect(await resolveWith(custom, '/site/en/a/b')).toEqual({ slug: 'a/b', locale: 'en' })
    expect(await resolveWith(custom, '/site/de/a')).toBeNull()
  })
})

describe('sitemap', () => {
  it('lists visible pages with absolute alternates', async () => {
    const pages: PageRef[] = [
      { pageId: 'pg_home', locale: 'hu', slug: '', url: '/', hidden: false },
      { pageId: 'pg_home', locale: 'en', slug: '', url: '/en', hidden: false },
      { pageId: 'pg_contact', locale: 'en', slug: 'contact', url: '/en/contact', hidden: true }
    ]
    const { fetch } = mockFetch([json(pages)])
    const entries = await createBrease({ token: 't', fetch }).sitemap('https://example.com/')
    const alternates = { hu: 'https://example.com/', en: 'https://example.com/en' }
    expect(entries).toEqual([
      { url: 'https://example.com/', alternates },
      { url: 'https://example.com/en', alternates }
    ])
  })
})
