import { env } from './env'
import { BreaseError } from './errors'
import type { Navigation, Page, PageRef, Redirect, Release, Site, SitemapEntry } from './types'
import { resolvePath } from './urls'

export { BreaseError } from './errors'
export type * from './types'
export { buildPath, normalizeSlug, resolvePath } from './urls'

export type BreaseOptions = {
  token?: string
  apiUrl?: string
  commit?: string | false
  fetch?: typeof fetch
  retries?: number
  retryBaseMs?: number
}

export interface Brease {
  getSite(): Promise<Site>
  getPage<T = Record<string, unknown>>(slug: string, opts: { locale: string }): Promise<Page<T> | null>
  getPages(opts?: { locale?: string }): Promise<PageRef[]>
  getNavigation(key: string, opts: { locale: string }): Promise<Navigation | null>
  getRedirects(): Promise<Redirect[]>
  getRelease(): Promise<Release>
  resolve(pathname: string): Promise<{ slug: string; locale: string } | null>
  sitemap(baseUrl: string): Promise<SitemapEntry[]>
}

const RETRY_AFTER_CAP_MS = 10_000
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

export function createBrease(opts: BreaseOptions = {}): Brease {
  const apiUrl = (opts.apiUrl ?? env('BREASE_API_URL') ?? 'https://api.brease.io').replace(/\/+$/, '')
  const commit = opts.commit === false ? undefined : (opts.commit ?? env('VERCEL_GIT_COMMIT_SHA'))
  const retries = opts.retries ?? 2
  const baseMs = opts.retryBaseMs ?? 300
  const doFetch: typeof fetch = opts.fetch ?? ((input, init) => fetch(input, init))
  let sitePromise: Promise<Site> | undefined

  async function request<T>(
    path: string,
    query: Record<string, string | undefined>,
    nullOn404: true
  ): Promise<T | null>
  async function request<T>(path: string, query?: Record<string, string | undefined>): Promise<T>
  async function request<T>(path: string, query: Record<string, string | undefined> = {}, nullOn404 = false) {
    const token = opts.token ?? env('BREASE_TOKEN')
    if (!token)
      throw new BreaseError('unauthorized', 'No Brease token: pass { token } or set BREASE_TOKEN', 401)
    const params = new URLSearchParams()
    for (const [k, v] of Object.entries(query)) if (v !== undefined) params.set(k, v)
    const qs = params.toString()
    const url = `${apiUrl}${path}${qs ? `?${qs}` : ''}`
    const headers: Record<string, string> = { authorization: `Bearer ${token}`, accept: 'application/json' }
    if (commit) headers['x-brease-commit'] = commit

    for (let attempt = 0; ; attempt++) {
      let res: Response
      try {
        res = await doFetch(url, { method: 'GET', headers })
      } catch (err) {
        if (attempt < retries) {
          await sleep(backoff(attempt))
          continue
        }
        throw new BreaseError('network', `Request to ${url} failed: ${(err as Error).message}`, 0)
      }
      if (res.ok) return (await res.json()) as T
      if (res.status === 404 && nullOn404) return null
      if ((res.status === 429 || res.status >= 500) && attempt < retries) {
        const after = Number(res.headers.get('retry-after'))
        await sleep(after > 0 ? Math.min(after * 1000, RETRY_AFTER_CAP_MS) : backoff(attempt))
        continue
      }
      throw await BreaseError.fromResponse(res)
    }
  }

  function backoff(attempt: number) {
    return baseMs * 2 ** attempt + Math.random() * baseMs
  }

  const client: Brease = {
    getSite() {
      sitePromise ??= request<Site>('/content-api/site').catch((err) => {
        sitePromise = undefined
        throw err
      })
      return sitePromise
    },
    getPage<T>(slug: string, { locale }: { locale: string }) {
      return request<Page<T>>('/content-api/page', { slug, locale }, true)
    },
    getPages(o = {}) {
      return request<PageRef[]>('/content-api/pages', { locale: o.locale })
    },
    getNavigation(key, { locale }) {
      return request<Navigation>(`/content-api/navigations/${encodeURIComponent(key)}`, { locale }, true)
    },
    getRedirects() {
      return request<Redirect[]>('/content-api/redirects')
    },
    getRelease() {
      return request<Release>('/content-api/release')
    },
    async resolve(pathname) {
      const site = await client.getSite()
      const result = resolvePath(site, pathname)
      return site.locales.includes(result.locale) ? result : null
    },
    async sitemap(baseUrl) {
      const base = baseUrl.replace(/\/+$/, '')
      const refs = (await client.getPages()).filter((r) => !r.hidden)
      const byPage = new Map<string, Record<string, string>>()
      for (const ref of refs) {
        const alternates = byPage.get(ref.pageId) ?? {}
        alternates[ref.locale] = `${base}${ref.url}`
        byPage.set(ref.pageId, alternates)
      }
      return refs.map((ref) => ({ url: `${base}${ref.url}`, alternates: byPage.get(ref.pageId) ?? {} }))
    }
  }
  return client
}
