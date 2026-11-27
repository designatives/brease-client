import { afterEach, describe, expect, it, vi } from 'vitest'
import { clearBreaseCache, createBrease } from './index'

function countingFetch(body: () => unknown, delayMs = 5) {
  const calls: { url: string; headers: Record<string, string> }[] = []
  const fn = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), headers: (init?.headers ?? {}) as Record<string, string> })
    await new Promise((r) => setTimeout(r, delayMs))
    return new Response(JSON.stringify(body()), {
      status: 200,
      headers: { 'content-type': 'application/json' }
    })
  })
  return { fetch: fn as unknown as typeof fetch, calls }
}

afterEach(() => {
  vi.unstubAllEnvs()
  vi.useRealTimers()
})

describe('request sharing', () => {
  it('shares identical requests in flight and gives each caller its own copy', async () => {
    const f = countingFetch(() => ({ slug: 'about', content: { title: 'A' } }))
    const b = createBrease({ token: 't', fetch: f.fetch, commit: false, branch: false })
    const [one, two] = await Promise.all([
      b.getPage('about', { locale: 'en' }),
      b.getPage('about', { locale: 'en' })
    ])
    expect(f.calls).toHaveLength(1)
    expect(one).toEqual(two)
    expect(one).not.toBe(two)
  })

  it('shares across clients with the same token, commit and branch, not across different ones', async () => {
    const f = countingFetch(() => ({ slug: 'x' }))
    const prod = createBrease({ token: 't', fetch: f.fetch, commit: 'c1', branch: false })
    const prod2 = createBrease({ token: 't', fetch: f.fetch, commit: 'c1', branch: false })
    const draft = createBrease({ token: 't', fetch: f.fetch, commit: 'c1', branch: 'brease/draft/chat_1' })
    const other = createBrease({ token: 'u', fetch: f.fetch, commit: 'c1', branch: false })
    await Promise.all([
      prod.getPage('x', { locale: 'en' }),
      prod2.getPage('x', { locale: 'en' }),
      draft.getPage('x', { locale: 'en' }),
      other.getPage('x', { locale: 'en' })
    ])
    expect(f.calls).toHaveLength(3)
    expect(f.calls.filter((c) => c.headers['x-brease-branch'] === 'brease/draft/chat_1')).toHaveLength(1)
  })

  it('asks again once a request has finished, unless cacheMs keeps it', async () => {
    const f = countingFetch(() => ({ slug: 'x' }), 0)
    const plain = createBrease({ token: 't', fetch: f.fetch, commit: false, branch: false })
    await plain.getPage('x', { locale: 'en' })
    await plain.getPage('x', { locale: 'en' })
    expect(f.calls).toHaveLength(2)

    const g = countingFetch(() => ({ slug: 'y' }), 0)
    const kept = createBrease({ token: 't', fetch: g.fetch, commit: false, branch: false, cacheMs: 30_000 })
    await kept.getPage('y', { locale: 'en' })
    await kept.getPage('y', { locale: 'en' })
    expect(g.calls).toHaveLength(1)
    clearBreaseCache()
    await kept.getPage('y', { locale: 'en' })
    expect(g.calls).toHaveLength(2)
  })

  it('never keeps responses in the editor preview or on a draft branch', async () => {
    const f = countingFetch(() => ({ slug: 'x' }), 0)
    const draft = createBrease({
      token: 't',
      fetch: f.fetch,
      commit: false,
      branch: 'brease/draft/chat_2',
      cacheMs: 30_000
    })
    await draft.getPage('x', { locale: 'en' })
    await draft.getPage('x', { locale: 'en' })
    expect(f.calls).toHaveLength(2)

    vi.stubEnv('BREASE_PREVIEW', '1')
    const g = countingFetch(() => ({ slug: 'x' }), 0)
    const preview = createBrease({
      token: 't',
      fetch: g.fetch,
      commit: false,
      branch: false,
      cacheMs: 30_000
    })
    await preview.getPage('x', { locale: 'en' })
    await preview.getPage('x', { locale: 'en' })
    expect(g.calls).toHaveLength(2)
  })

  it('drops a failed request so the next call tries again', async () => {
    let fail = true
    const fn = vi.fn(async () => {
      if (fail) return new Response('{"error":"unauthorized"}', { status: 401 })
      return new Response('{"slug":"x"}', { status: 200 })
    })
    const b = createBrease({ token: 't', fetch: fn as unknown as typeof fetch, commit: false, branch: false })
    await expect(b.getPage('x', { locale: 'en' })).rejects.toThrow()
    fail = false
    expect(await b.getPage('x', { locale: 'en' })).toEqual({ slug: 'x' })
  })
})
