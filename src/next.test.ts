import { afterEach, describe, expect, it, vi } from 'vitest'
import { breaseFetch, breaseRedirects } from './next'

describe('breaseFetch', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.unstubAllEnvs()
  })

  it('tags requests for revalidation on the live site', async () => {
    const fetch = vi.fn(async () => new Response('{}'))
    vi.stubGlobal('fetch', fetch)
    await breaseFetch(['page'], 60)('https://api.test/content-api/site')
    expect(fetch).toHaveBeenCalledWith('https://api.test/content-api/site', {
      next: { tags: ['brease', 'page'], revalidate: 60 }
    })
  })

  it('skips the cache in the Brease editor preview', async () => {
    const fetch = vi.fn(async () => new Response('{}'))
    vi.stubGlobal('fetch', fetch)
    vi.stubEnv('BREASE_PREVIEW', '1')
    await breaseFetch()('https://api.test/content-api/site')
    expect(fetch).toHaveBeenCalledWith('https://api.test/content-api/site', { cache: 'no-store' })
  })
})

describe('breaseRedirects', () => {
  it('maps Brease redirects to next.config redirects, and builds on without them', async () => {
    const ok = breaseRedirects({
      getRedirects: async () => [{ source: '/old', destination: '/new', status: 301 }]
    })
    expect(await ok()).toEqual([{ source: '/old', destination: '/new', statusCode: 301 }])
    const down = breaseRedirects({
      getRedirects: async () => {
        throw new Error('offline')
      }
    })
    expect(await down()).toEqual([])
  })
})
