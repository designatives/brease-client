import type {
  Navigation,
  NavigationItem,
  Page,
  PageRef,
  PageSeo,
  Redirect,
  ResolvedSeo,
  Site,
  SiteSeo,
  UrlSettings
} from './types'
import { buildPath, normalizeSlug } from './urls'

// Offline mode (BREASE_OFFLINE=1): the content comes from a brease-seed/ folder (Brease's content export)
// instead of the API, so a site keeps building and rendering without Brease. The answers have the API's shapes;
// images ($file) point at `mediaUrl` (default "/", so brease-seed/media/… is served from the site's public
// folder; `brease-client offline-media public` copies it there).

type SeedPageLocale = { slug: string; hidden?: boolean; seo?: PageSeo; content?: Record<string, unknown> }
type SeedPage = {
  meta: { name: string; parentId?: string | null; order?: number; excludedLocales?: string[] }
  locales: Record<string, SeedPageLocale>
}
type SeedNavItem = {
  id: string
  label: Record<string, string>
  pageId?: string
  url?: string
  target?: '_self' | '_blank'
  children?: SeedNavItem[]
}
export type Seed = {
  site: { name: string; seo?: Record<string, SiteSeo> }
  // The site's URL settings and address, written by the export (offline.json).
  settings: UrlSettings & { url?: string | null }
  pages: Record<string, SeedPage>
  navigations: Record<string, { items: SeedNavItem[] }>
  redirects: Redirect[]
}

// Reads a brease-seed/ folder (Node only: offline mode runs on the server or at build time).
export async function readSeed(dir: string): Promise<Seed> {
  const { readFile, readdir } = await import('node:fs/promises')
  const { join } = await import('node:path')
  const json = async <T>(path: string, fallback?: T): Promise<T> => {
    try {
      return JSON.parse(await readFile(join(dir, path), 'utf8')) as T
    } catch (error) {
      if (fallback !== undefined) return fallback
      throw new Error(`Brease offline mode: can't read ${join(dir, path)} (${(error as Error).message})`)
    }
  }
  const list = (path: string) => readdir(join(dir, path)).catch(() => [] as string[])
  const site = await json<Seed['site']>('site.json')
  const settings = await json<Seed['settings']>('offline.json', {
    locales: [],
    defaultLocale: '',
    localeStrategy: 'PREFIX_EXCEPT_DEFAULT'
  })
  const pages: Seed['pages'] = {}
  for (const id of await list('pages')) {
    const files = await list(`pages/${id}`)
    const locales: Record<string, SeedPageLocale> = {}
    for (const f of files)
      if (f !== 'page.json' && f.endsWith('.json'))
        locales[f.slice(0, -5)] = await json<SeedPageLocale>(`pages/${id}/${f}`)
    pages[id] = { meta: await json(`pages/${id}/page.json`), locales }
  }
  const navigations: Seed['navigations'] = {}
  for (const f of await list('navigations'))
    if (f.endsWith('.json')) navigations[f.slice(0, -5)] = await json(`navigations/${f}`)
  if (!settings.locales.length) {
    const found = [...new Set(Object.values(pages).flatMap((p) => Object.keys(p.locales)))].sort()
    settings.locales = found
    settings.defaultLocale ||= found[0] ?? 'en'
  }
  return { site, settings, pages, navigations, redirects: await json<Redirect[]>('redirects.json', []) }
}

const absolute = (seed: Seed, path: string) =>
  seed.settings.url ? `${seed.settings.url.replace(/\/+$/, '')}${path}` : path

function pathOf(seed: Seed, pageId: string, locale: string) {
  const entry = seed.pages[pageId]?.locales[locale]
  return entry ? buildPath(seed.settings, entry.slug, locale) : null
}

const PAGE_ANCHOR = /<a\b[^>]*\bdata-brease-page="([^"]+)"[^>]*>/g
const FILE_REF = /brease-file:([^\s"'<>()]+)/g

// Rich text: exported media (brease-file:<path>) → a URL of the file, and page links (data-brease-page) → the
// page's URL in this locale, as the delivery API sets them.
function resolveText(seed: Seed, text: string, locale: string, mediaUrl: string) {
  let out = text.includes('brease-file:')
    ? text.replace(
        FILE_REF,
        (_m, path: string) => `${mediaUrl.replace(/\/+$/, '')}/${path.replace(/^\/+/, '')}`
      )
    : text
  if (out.includes('data-brease-page'))
    out = out.replace(PAGE_ANCHOR, (tag, pageId: string) => {
      const href = pathOf(seed, pageId, locale)
      if (!href) return tag
      return /\shref="[^"]*"/.test(tag)
        ? tag.replace(/\shref="[^"]*"/, ` href="${href}"`)
        : tag.replace(/^<a\b/, `<a href="${href}"`)
    })
  return out
}

// $file → a URL, and page links ({ pageId, href }) → the page's URL in this locale, like the delivery API.
function resolveContent(seed: Seed, value: unknown, locale: string, mediaUrl: string): unknown {
  if (typeof value === 'string') return resolveText(seed, value, locale, mediaUrl)
  if (Array.isArray(value)) return value.map((v) => resolveContent(seed, v, locale, mediaUrl))
  if (!value || typeof value !== 'object') return value
  const obj = value as Record<string, unknown>
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(obj)) out[k] = resolveContent(seed, v, locale, mediaUrl)
  if (typeof obj.$file === 'string') {
    const { $file, ...rest } = out
    return {
      assetId: `file:${obj.$file}`,
      url: `${mediaUrl.replace(/\/+$/, '')}/${obj.$file.replace(/^\/+/, '')}`,
      ...rest
    }
  }
  if (typeof obj.pageId === 'string' && typeof obj.href === 'string') {
    const path = pathOf(seed, obj.pageId, locale)
    if (path) out.href = path
  }
  return out
}

function alternatesOf(seed: Seed, pageId: string) {
  const page = seed.pages[pageId]
  const out: Record<string, string> = {}
  for (const locale of seed.settings.locales) {
    const path = pathOf(seed, pageId, locale)
    if (path && !page?.locales[locale]?.hidden) out[locale] = absolute(seed, path)
  }
  return out
}

function resolvedSeo(
  seed: Seed,
  page: SeedPage,
  entry: SeedPageLocale,
  locale: string,
  url: string,
  alternates: Record<string, string>
): ResolvedSeo {
  const siteSeo = seed.site.seo?.[locale] ?? {}
  const seo = entry.seo ?? {}
  const base = seo.title ?? page.meta.name
  const title =
    seo.useTitleTemplate !== false && siteSeo.titleTemplate ? siteSeo.titleTemplate.replace('%s', base) : base
  const robots = { index: true, follow: true, ...(siteSeo.robots ?? {}), ...(seo.robots ?? {}) }
  return {
    title,
    description: seo.description ?? siteSeo.description,
    canonical: seo.canonical ?? url,
    robots,
    openGraph: {
      type: siteSeo.openGraph?.type ?? 'website',
      title: seo.openGraph?.title ?? base,
      description: seo.openGraph?.description ?? seo.description ?? siteSeo.description,
      image: seo.openGraph?.image ?? siteSeo.openGraph?.image ?? siteSeo.defaultImage,
      url,
      siteName: siteSeo.siteName ?? seed.site.name
    },
    twitter: { ...(siteSeo.twitter ?? {}), ...(seo.twitter ?? {}) },
    structuredData: [...(siteSeo.structuredData ?? []), ...(seo.structuredData ?? [])],
    alternates,
    customHead: siteSeo.customHead,
    customCode: seo.customCode ?? siteSeo.customCode,
    favicon: siteSeo.favicon
  }
}

function pageFor(seed: Seed, pageId: string, locale: string, mediaUrl: string): Page | null {
  const page = seed.pages[pageId]
  const entry = page?.locales[locale]
  if (!page || !entry) return null
  const path = buildPath(seed.settings, entry.slug, locale)
  const url = absolute(seed, path)
  const alternates = alternatesOf(seed, pageId)
  return {
    pageId,
    name: page.meta.name,
    locale,
    slug: normalizeSlug(entry.slug),
    url,
    hidden: !!entry.hidden,
    content: resolveContent(seed, entry.content ?? {}, locale, mediaUrl) as Record<string, unknown>,
    seo: entry.seo ?? {},
    resolvedSeo: resolvedSeo(seed, page, entry, locale, url, alternates),
    alternates,
    ...(page.meta.excludedLocales?.length ? { excludedLocales: page.meta.excludedLocales } : {})
  }
}

function navItems(seed: Seed, items: SeedNavItem[], locale: string): NavigationItem[] {
  return items.map((item) => ({
    id: item.id,
    label: item.label[locale] ?? Object.values(item.label)[0] ?? '',
    url: (item.pageId && pathOf(seed, item.pageId, locale)) || item.url || '#',
    ...(item.pageId ? { pageId: item.pageId } : {}),
    ...(item.target ? { target: item.target } : {}),
    children: navItems(seed, item.children ?? [], locale)
  }))
}

const reply = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

// A fetch that answers the content API's routes from a seed, so the client works unchanged.
export function offlineFetch(load: () => Promise<Seed>, mediaUrl: string): typeof fetch {
  return async (input) => {
    const seed = await load()
    const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url)
    const q = url.searchParams
    const path = url.pathname.replace(/^.*\/content-api/, '')
    const locales = seed.settings.locales
    const locale = q.get('locale') || seed.settings.defaultLocale
    if (path === '/site') {
      const site: Site = {
        name: seed.site.name,
        locales,
        defaultLocale: seed.settings.defaultLocale,
        localeStrategy: seed.settings.localeStrategy,
        urlTemplate: seed.settings.urlTemplate ?? null,
        seo: seed.site.seo ?? {},
        analytics: null,
        verification: null,
        url: seed.settings.url ?? null
      }
      return reply(200, site)
    }
    if (path === '/redirects') return reply(200, seed.redirects)
    if (path === '/release') return reply(200, { id: 'offline', number: 0, commitSha: '', liveAt: null })
    if (path === '/page') {
      const slug = normalizeSlug(q.get('slug') ?? '')
      const id = Object.keys(seed.pages).find((pid) => {
        const e = seed.pages[pid]?.locales[locale]
        return e && normalizeSlug(e.slug) === slug
      })
      const page = id ? pageFor(seed, id, locale, mediaUrl) : null
      return page ? reply(200, page) : reply(404, { message: { title: 'Page not found' } })
    }
    if (path === '/pages') {
      const wanted = q.get('locale') ? [locale] : locales
      const withContent = q.get('withContent') === '1'
      const parent = q.has('parentId') ? q.get('parentId') || null : undefined
      const template = q.get('template')
      const refs: PageRef[] = []
      for (const [pageId, page] of Object.entries(seed.pages)) {
        if (parent !== undefined && (page.meta.parentId ?? null) !== parent) continue
        for (const l of wanted) {
          const entry = page.locales[l]
          if (!entry) continue
          const tpl = typeof entry.content?.template === 'string' ? entry.content.template : null
          if (template && tpl !== template) continue
          if (withContent && entry.hidden) continue
          refs.push({
            pageId,
            locale: l,
            slug: normalizeSlug(entry.slug),
            url: absolute(seed, buildPath(seed.settings, entry.slug, l)),
            hidden: !!entry.hidden,
            name: page.meta.name,
            index: entry.seo?.robots?.index !== false,
            parentId: page.meta.parentId ?? null,
            order: page.meta.order ?? 0,
            template: tpl,
            ...(withContent
              ? { content: resolveContent(seed, entry.content ?? {}, l, mediaUrl) as Record<string, unknown> }
              : {})
          })
        }
      }
      return reply(200, refs)
    }
    const nav = /^\/navigations\/([^/]+)$/.exec(path)
    if (nav) {
      const key = decodeURIComponent(nav[1] as string)
      const file = seed.navigations[key]
      if (!file) return reply(404, { message: { title: 'Navigation not found' } })
      const body: Navigation = { key, locale, items: navItems(seed, file.items, locale) }
      return reply(200, body)
    }
    return reply(404, { message: { title: 'Not available offline' } })
  }
}
