import { env } from './env'
import { BreaseError } from './errors'
import type { Navigation, Page, PageRef, Redirect, Release, Site, SitemapEntry, UrlSettings } from './types'
import { resolvePath } from './urls'

export { BreaseError } from './errors'
export { type LocaleLink, localeHref, localeLinks, nativeName } from './locales'
export type * from './types'
export { buildPath, normalizeSlug, resolvePath } from './urls'

export type LocaleContext = {
  locale: string
  settings: UrlSettings
  // The page's path in each locale it exists in.
  alternates: Record<string, string>
  // The home page's path in each locale that has one: where a locale switcher goes when the page itself has
  // no version in that locale. Locales in neither have no content yet.
  homes: Record<string, string>
}

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
  // For one catch-all route serving every locale (app/[[...path]] in Next.js): the locale and slug of a
  // request's path segments, or null when no page can live there (unknown locale, shared "_" content).
  route(path?: string | string[]): Promise<{ slug: string; locale: string } | null>
  // That route's static params: the path segments of every published page in every locale.
  routes(): Promise<{ path: string[] }[]>
  // What a page's locale-aware parts need (a switcher, links built in code, <html lang>): the
  // locale, the URL settings and the page's URL in every locale. Null where no page can live, and for a
  // locale that has no content yet.
  localeContext(path?: string | string[]): Promise<LocaleContext | null>
  sitemap(baseUrl: string): Promise<SitemapEntry[]>
}

const RETRY_AFTER_CAP_MS = 10_000
const SITE_TTL_MS = 60_000
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

export function createBrease(opts: BreaseOptions = {}): Brease {
  const apiUrl = (opts.apiUrl ?? env('BREASE_API_URL') ?? 'https://api.brease.io').replace(/\/+$/, '')
  const commit = opts.commit === false ? undefined : (opts.commit ?? env('VERCEL_GIT_COMMIT_SHA'))
  const retries = opts.retries ?? 2
  const baseMs = opts.retryBaseMs ?? 300
  const doFetch: typeof fetch = opts.fetch ?? ((input, init) => fetch(input, init))
  // Re-read after a minute, so a locale added in Brease is served without a restart.
  let site: { promise: Promise<Site>; at: number } | undefined

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
      if (!site || Date.now() - site.at > SITE_TTL_MS) {
        const promise = request<Site>('/content-api/site').catch((err) => {
          if (site?.promise === promise) site = undefined
          throw err
        })
        site = { promise, at: Date.now() }
      }
      return site.promise
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
    async route(path) {
      const joined = Array.isArray(path) ? path.map((p) => decodeURIComponent(p)).join('/') : (path ?? '')
      const result = await client.resolve(`/${joined}`)
      return result && !result.slug.split('/').some((part) => part.startsWith('_')) ? result : null
    },
    async routes() {
      const refs = await client.getPages()
      return refs
        .filter((r) => !r.hidden && !r.slug.split('/').some((part) => part.startsWith('_')))
        .map((r) => ({ path: r.url.split('/').filter(Boolean) }))
    },
    async localeContext(path) {
      const target = await client.route(path)
      if (!target) return null
      const [site, page, home] = await Promise.all([
        client.getSite(),
        client.getPage(target.slug, { locale: target.locale }),
        client.getPage('', { locale: target.locale })
      ])
      const settings: UrlSettings = {
        locales: site.locales,
        defaultLocale: site.defaultLocale,
        localeStrategy: site.localeStrategy,
        urlTemplate: site.urlTemplate
      }
      // A locale without content yet (added, not translated) is treated like no locale at all.
      if (!page && !home) return null
      const alternates: Record<string, string> = {}
      for (const [locale, url] of Object.entries(page?.alternates ?? {})) alternates[locale] = pathOf(url)
      const homes: Record<string, string> = {}
      for (const [locale, url] of Object.entries(home?.alternates ?? {})) homes[locale] = pathOf(url)
      return { locale: target.locale, settings, alternates, homes }
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

function pathOf(url: string) {
  try {
    return new URL(url, 'http://localhost').pathname
  } catch {
    return url
  }
}
