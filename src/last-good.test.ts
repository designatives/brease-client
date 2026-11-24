import { afterEach, describe, expect, it, vi } from 'vitest'
import { BreaseError } from './errors'
import { isBreaseOutage, lastGoodKey, withLastGood } from './index'

// A Cache API stand-in keyed by URL, like Cloudflare's caches.default.
function memoryCache() {
  const store = new Map<string, Response>()
  const cache = {
    match: async (req: Request) => store.get(req.url)?.clone(),
    put: async (req: Request, res: Response) => {
      store.set(req.url, res)
    }
  } as unknown as Cache
  return { cache, store }
}

const html = (body: string, headers: Record<string, string> = {}) =>
  new Response(body, { status: 200, headers: { 'content-type': 'text/html; charset=utf-8', ...headers } })
const outage = () => Promise.reject(new BreaseError('network', 'Request failed', 0))
const page = (url = 'https://site.test/about', init: RequestInit = {}) => new Request(url, init)

afterEach(() => {
  vi.unstubAllEnvs()
  vi.useRealTimers()
})

describe('withLastGood', () => {
  it('stores a good page and serves it, marked stale, when Brease is down', async () => {
    const { cache } = memoryCache()
    const first = await withLastGood(page(), async () => html('<h1>About</h1>'), { cache })
    expect(await first.text()).toBe('<h1>About</h1>')
    const down = await withLastGood(page(), outage, { cache })
    expect(down.status).toBe(200)
    expect(down.headers.get('x-brease-stale')).toBeTruthy()
    expect(down.headers.get('cache-control')).toBe('no-store')
    expect(await down.text()).toBe('<h1>About</h1>')
  })

  it('serves the copy for a 5xx render too, but not for other errors', async () => {
    const { cache } = memoryCache()
    await withLastGood(page(), async () => html('ok'), { cache })
    const fivexx = await withLastGood(page(), async () => new Response('boom', { status: 500 }), { cache })
    expect(await fivexx.text()).toBe('ok')
    await expect(withLastGood(page(), () => Promise.reject(new Error('bug')), { cache })).rejects.toThrow(
      'bug'
    )
    const notFound = new BreaseError('not_found', 'No page', 404)
    await expect(withLastGood(page(), () => Promise.reject(notFound), { cache })).rejects.toBe(notFound)
  })

  it('rethrows the outage when there is no copy', async () => {
    const { cache } = memoryCache()
    await expect(withLastGood(page(), outage, { cache })).rejects.toBeInstanceOf(BreaseError)
  })

  it('never stores personal, non-HTML, non-200 or non-GET responses', async () => {
    const { cache, store } = memoryCache()
    await withLastGood(page(), async () => html('x', { 'set-cookie': 'a=1' }), { cache })
    await withLastGood(page(), async () => html('x', { 'cache-control': 'private' }), { cache })
    await withLastGood(
      page(),
      async () => new Response('{}', { headers: { 'content-type': 'application/json' } }),
      {
        cache
      }
    )
    await withLastGood(
      page(),
      async () => new Response('gone', { status: 404, headers: { 'content-type': 'text/html' } }),
      {
        cache
      }
    )
    await withLastGood(
      page('https://site.test/about', { headers: { cookie: 'session_id=abc' } }),
      async () => html('x'),
      {
        cache
      }
    )
    await withLastGood(page('https://site.test/about', { method: 'POST' }), async () => html('x'), { cache })
    expect(store.size).toBe(0)
  })

  it('a signed-in visitor never gets the shared copy', async () => {
    const { cache } = memoryCache()
    await withLastGood(page(), async () => html('public'), { cache })
    const req = page('https://site.test/about', { headers: { cookie: 'auth_token=1' } })
    await expect(withLastGood(req, outage, { cache })).rejects.toBeInstanceOf(BreaseError)
  })

  it('skips the editor preview and draft branches', async () => {
    const { cache, store } = memoryCache()
    vi.stubEnv('BREASE_PREVIEW', '1')
    await withLastGood(page(), async () => html('draft'), { cache })
    expect(store.size).toBe(0)
  })

  it('keeps copies for a day by default', async () => {
    vi.useFakeTimers()
    const { cache } = memoryCache()
    await withLastGood(page(), async () => html('old'), { cache })
    vi.advanceTimersByTime(86_400_000 + 1000)
    await expect(withLastGood(page(), outage, { cache })).rejects.toBeInstanceOf(BreaseError)
  })

  it('hands storing to waitUntil when given', async () => {
    const { cache, store } = memoryCache()
    const waits: Promise<unknown>[] = []
    await withLastGood(page(), async () => html('x'), { cache, waitUntil: (p) => waits.push(p) })
    expect(waits).toHaveLength(1)
    await Promise.all(waits)
    expect(store.size).toBe(1)
  })
})

describe('lastGoodKey and isBreaseOutage', () => {
  it('drops tracking parameters and sorts the rest', () => {
    expect(lastGoodKey('https://s.test/a?utm_source=x&b=2&gclid=1&a=1#top')).toBe('https://s.test/a?a=1&b=2')
  })

  it('counts network errors and API 5xx as an outage', () => {
    expect(isBreaseOutage(new BreaseError('network', 'x', 0))).toBe(true)
    expect(isBreaseOutage(new BreaseError('upstream', 'x', 503))).toBe(true)
    expect(isBreaseOutage(new BreaseError('not_found', 'x', 404))).toBe(false)
    expect(isBreaseOutage(new Error('x'))).toBe(false)
  })
})
