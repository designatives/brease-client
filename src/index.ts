import { env } from './env'
import { BreaseError } from './errors'
import type { Navigation, Page, PageRef, Redirect, Release, Site, SitemapEntry, UrlSettings } from './types'
import { resolvePath } from './urls'

export { type Ga4Tag, ga4Html, ga4Tag, grantAnalytics } from './analytics'
export { type CustomTag, customTags } from './custom-code'
export { BreaseError } from './errors'
export { type LocaleLink, localeHref, localeLinks, nativeName } from './locales'
export { fieldPath, navPath } from './markers'
export { matchRedirect } from './redirects'
export { type BreaseSection, checkSections, sectionAttrs, sectionsAttrs } from './sections'
export {
  hmacHex,
  type RevalidateBody,
  type RevalidateTarget,
  verifyRevalidate,
  verifySignature
} from './signature'
export { type JsonLd, jsonLd, jsonLdHtml } from './structured-data'
export { renderTemplate, type TemplateData } from './template'
export type * from './types'
export { buildPath, canonicalPath, normalizeSlug, resolvePath } from './urls'

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
  // Defaults to the commit the host builds: Vercel, Cloudflare Workers Builds or Cloudflare Pages.
  commit?: string | false
  // The deployment's git branch. On a Brease draft branch, a commit Brease didn't make (a developer's fix)
  // still reads the draft's content.
  branch?: string | false
  fetch?: typeof fetch
  retries?: number
  retryBaseMs?: number
  // Per request; a timed-out request isn't retried. Keep it short where a visitor waits on it (a proxy).
  timeoutMs?: number
}

export interface Brease {
  getSite(): Promise<Site>
  getPage<T = Record<string, unknown>>(slug: string, opts: { locale: string }): Promise<Page<T> | null>
  getPages<T = Record<string, unknown>>(opts?: {
    locale?: string
    // null: top-level pages only.
    parentId?: string | null
    template?: string
    withContent?: boolean
  }): Promise<PageRef<T>[]>
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
const DRAFT_BRANCH_PREFIX = 'brease/draft/'
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

// The commit and branch the host is building, each pair read from the same host.
const HOST_GIT_ENV = [
  ['VERCEL_GIT_COMMIT_SHA', 'VERCEL_GIT_COMMIT_REF'],
  ['WORKERS_CI_COMMIT_SHA', 'WORKERS_CI_BRANCH'],
  ['CF_PAGES_COMMIT_SHA', 'CF_PAGES_BRANCH']
] as const

function hostGit(): { commit?: string; branch?: string } {
  for (const [commit, branch] of HOST_GIT_ENV) {
    const sha = env(commit)
    if (sha) return { commit: sha, branch: env(branch) }
  }
  return {}
}

// Bumped by clearBreaseCache: every client then re-reads its site and redirects on next use.
let cacheGeneration = 0

// Drops the site and redirects every client keeps for a minute; revalidateHandler calls it on a publish.
export function clearBreaseCache() {
  cacheGeneration++
}

export function createBrease(opts: BreaseOptions = {}): Brease {
  const apiUrl = (opts.apiUrl ?? env('BREASE_API_URL') ?? 'https://api.brease.io').replace(/\/+$/, '')
  const host = hostGit()
  const commit = opts.commit === false ? undefined : (opts.commit ?? host.commit)
  // Only draft branches matter to Brease; sending others would only split the API's cache.
  const branch = opts.branch === false ? undefined : (opts.branch ?? host.branch)
  const draftBranch = branch?.startsWith(DRAFT_BRANCH_PREFIX) ? branch : undefined
  const retries = opts.retries ?? 2
  const baseMs = opts.retryBaseMs ?? 300
  const timeoutMs = opts.timeoutMs ?? 5_000
  const doFetch: typeof fetch = opts.fetch ?? ((input, init) => fetch(input, init))
  // Re-read after a minute, so a locale added in Brease is served without a restart. While Brease can't be
  // reached, the last good value is served (and kept for another minute) instead of failing every request.
  // The editor's preview (BREASE_PREVIEW=1) always reads fresh, like breaseFetch.
  function cached<T>(path: string) {
    let entry: { promise: Promise<T>; at: number; generation: number } | undefined
    let last: { value: T } | undefined
    return () => {
      if (
        !entry ||
        Date.now() - entry.at > SITE_TTL_MS ||
        entry.generation !== cacheGeneration ||
        env('BREASE_PREVIEW')
      ) {
        const promise: Promise<T> = request<T>(path).then(
          (value) => {
            last = { value }
            return value
          },
          (err) => {
            if (last) return last.value
            if (entry?.promise === promise) entry = undefined
            throw err
          }
        )
        entry = { promise, at: Date.now(), generation: cacheGeneration }
      }
      return entry.promise
    }
  }

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
    if (draftBranch) headers['x-brease-branch'] = draftBranch

    for (let attempt = 0; ; attempt++) {
      let res: Response
      try {
        res = await doFetch(url, { method: 'GET', headers, signal: AbortSignal.timeout(timeoutMs) })
      } catch (err) {
        const timedOut = (err as Error).name === 'TimeoutError'
        if (attempt < retries && !timedOut) {
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

  const cachedSite = cached<Site>('/content-api/site')
  const cachedRedirects = cached<Redirect[]>('/content-api/redirects')

  const client: Brease = {
    getSite: cachedSite,
    getPage<T>(slug: string, { locale }: { locale: string }) {
      return request<Page<T>>('/content-api/page', { slug, locale }, true)
    },
    getPages<T>(o: Parameters<Brease['getPages']>[0] = {}) {
      return request<PageRef<T>[]>('/content-api/pages', {
        locale: o.locale,
        parentId: o.parentId === null ? '' : o.parentId,
        template: o.template,
        withContent: o.withContent ? '1' : undefined
      })
    },
    getNavigation(key, { locale }) {
      return request<Navigation>(`/content-api/navigations/${encodeURIComponent(key)}`, { locale }, true)
    },
    // Cached for a minute, like the site: a proxy applies redirects per request (matchRedirect).
    getRedirects: cachedRedirects,
    getRelease() {
      return request<Release>('/content-api/release')
    },
    async resolve(pathname) {
      const site = await client.getSite()
      const result = resolvePath(site, pathname)
      return site.locales.includes(result.locale) ? result : null
    },
    async route(path) {
      // resolve() decodes the path once.
      // A request path ("/de/about") or its segments; leading and doubled slashes don't change the page.
      const joined = (Array.isArray(path) ? path.join('/') : (path ?? ''))
        .replace(/^\/+/, '')
        .replace(/\/{2,}/g, '/')
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
      // Only pages search may show: not hidden, not kept out of search, not site-wide content.
      const refs = (await client.getPages()).filter(
        (r) => !r.hidden && r.index !== false && !r.slug.split('/').some((part) => part.startsWith('_'))
      )
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
