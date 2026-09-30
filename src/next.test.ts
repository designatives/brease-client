import { afterEach, describe, expect, it, vi } from 'vitest'
import { breaseFetch } from './next'

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
