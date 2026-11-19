/// <reference types="node" />
import {
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync
} from 'node:fs'
import { createServer } from 'node:http'
import { dirname, extname, join, relative } from 'node:path'
import type { Brease } from './index'
import { matchRedirect } from './redirects'
import { renderTemplate } from './template'
import type { Navigation, Page, Redirect } from './types'

// `brease-client build` and `serve` for sites without a framework: the site's own HTML pages, moved into
// templates/, are filled from Brease (see template.ts). build writes every published page in every locale to
// dist/<url>/index.html with the site's other files beside them; serve renders each request live for the
// editor's preview. `output <dir>` writes Brease's redirects in the host's format; `content <file>` writes the
// content a browser-only app (a Vite SPA) reads at build time.

export const TEMPLATES_DIR = 'templates'

// What build copies and serve serves besides the rendered pages. Only an allow-list goes out: the site's asset
// folders, and anything else only when a template (or a stylesheet it uses) references it. Never dotfiles
// (.env, .npmrc, .dev.vars), sources and configs of the old site (PHP, Markdown, YAML/TOML, lockfiles) or
// Brease's own folders.
const ASSET_DIRS = new Set(['public', 'static', 'assets', 'images', 'img', 'css', 'js', 'fonts', 'media'])
const NEVER_DIRS = new Set([
  TEMPLATES_DIR,
  'dist',
  'node_modules',
  'scripts',
  'brease-seed',
  'vendor',
  'content',
  'layouts',
  'archetypes',
  'data',
  '_data',
  '_includes',
  '_layouts',
  '_posts',
  '_drafts',
  '_site',
  'src'
])
const ASSET_EXT = new Set([
  '.css',
  '.js',
  '.mjs',
  '.map',
  '.svg',
  '.png',
  '.jpg',
  '.jpeg',
  '.webp',
  '.avif',
  '.gif',
  '.ico',
  '.bmp',
  '.woff',
  '.woff2',
  '.ttf',
  '.otf',
  '.eot',
  '.pdf',
  '.mp4',
  '.webm',
  '.mp3',
  '.ogg',
  '.wav',
  '.txt',
  '.webmanifest',
  '.vtt'
])
const REFERENCE =
  /(?:\b(?:src|href|poster|data-src)\s*=\s*["']([^"']+)["']|url\(\s*["']?([^"')]+)["']?\s*\))/gi

// Paths (relative to the root, forward slashes) a piece of HTML or CSS at `fromDir` refers to on this site.
function references(text: string, fromDir: string) {
  const out: string[] = []
  const add = (raw: string) => {
    const clean = raw.trim().split(/[?#]/)[0] ?? ''
    if (!clean || /^[a-z][a-z0-9+.-]*:/i.test(clean) || clean.startsWith('//')) return
    const rel = clean.startsWith('/') ? clean.slice(1) : join(fromDir, clean)
    out.push(rel.split(/[\\/]+/).join('/'))
  }
  for (const m of text.matchAll(REFERENCE)) add((m[1] ?? m[2]) as string)
  for (const m of text.matchAll(/\bsrcset\s*=\s*["']([^"']+)["']/gi))
    for (const part of (m[1] as string).split(',')) add(part.trim().split(/\s+/)[0] ?? '')
  return out
}

function readText(file: string) {
  try {
    return readFileSync(file, 'utf8')
  } catch {
    return ''
  }
}

// Every file the templates reference, and what their stylesheets reference in turn (fonts, background images).
export function referencedAssets(root: string) {
  const found = new Set<string>()
  const dir = join(root, TEMPLATES_DIR)
  const queue: string[] = []
  if (existsSync(dir))
    for (const name of readdirSync(dir))
      if (name.endsWith('.html')) queue.push(...references(readText(join(dir, name)), ''))
  while (queue.length) {
    const rel = queue.shift() as string
    if (found.has(rel)) continue
    found.add(rel)
    if (rel.endsWith('.css')) queue.push(...references(readText(join(root, rel)), dirname(rel)))
  }
  return found
}

// Whether a file (relative to the root, forward slashes) may be published as one of the site's files.
export function isPublicAsset(rel: string, referenced: Set<string>) {
  const parts = rel.split('/').filter(Boolean)
  if (!parts.length || parts.some((p) => p.startsWith('.') || p === '..')) return false
  if (NEVER_DIRS.has(parts[0] as string)) return false
  if (!ASSET_EXT.has(extname(rel).toLowerCase())) return false
  return ASSET_DIRS.has(parts[0] as string) || referenced.has(parts.join('/'))
}

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css',
  '.js': 'text/javascript',
  '.mjs': 'text/javascript',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.gif': 'image/gif',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain',
  '.xml': 'application/xml',
  '.pdf': 'application/pdf',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm'
}

// The template for a page: templates/<template>.html for pages that name one, templates/home.html for the home
// page when there is one, else templates/page.html.
export function templateFor(root: string, page: { slug: string; template?: string | null }) {
  const dir = join(root, TEMPLATES_DIR)
  const candidates = [
    page.template ? `${page.template}.html` : null,
    page.slug === '' ? 'home.html' : null,
    'page.html'
  ].filter((c): c is string => !!c)
  for (const name of candidates) if (existsSync(join(dir, name))) return join(dir, name)
  return null
}

// The menus a template uses (data-brease="nav:<key>").
export const navigationKeys = (html: string) => [
  ...new Set([...html.matchAll(/data-brease="nav:([^"]+)"/g)].map((m) => m[1] as string))
]

async function renderPage(brease: Brease, root: string, slug: string, locale: string) {
  const page = (await brease.getPage(slug, { locale })) as (Page & { template?: string | null }) | null
  if (!page) return null
  const file = templateFor(root, {
    slug,
    template: (page.content as { template?: string }).template ?? page.template
  })
  if (!file) throw new Error(`No template for "${slug || 'home'}": add ${TEMPLATES_DIR}/page.html`)
  const template = readFileSync(file, 'utf8')
  const [global, navigations] = await Promise.all([
    template.includes('_global:') ? brease.getPage('_global', { locale }).catch(() => null) : null,
    Promise.all(
      navigationKeys(template).map(async (key) => [
        key,
        await brease.getNavigation(key, { locale }).catch(() => null)
      ])
    )
  ])
  return renderTemplate(template, {
    page,
    global,
    navigations: Object.fromEntries(navigations) as Record<string, Navigation | null>
  })
}

const outFile = (out: string, path: string[]) => join(out, ...path, 'index.html')

function copyAssets(root: string, out: string) {
  const referenced = referencedAssets(root)
  const walk = (rel: string) => {
    for (const name of readdirSync(join(root, rel))) {
      if (name.startsWith('.')) continue
      const child = rel ? `${rel}/${name}` : name
      if (!rel && NEVER_DIRS.has(name)) continue
      const full = join(root, child)
      if (statSync(full).isDirectory()) walk(child)
      else if (isPublicAsset(child, referenced)) {
        mkdirSync(dirname(join(out, child)), { recursive: true })
        cpSync(full, join(out, child))
      }
    }
  }
  walk('')
}

export async function build(brease: Brease, opts: { root?: string; out?: string; host?: Host } = {}) {
  const root = opts.root ?? process.cwd()
  const out = join(root, opts.out ?? 'dist')
  rmSync(out, { recursive: true, force: true })
  mkdirSync(out, { recursive: true })
  copyAssets(root, out)
  const pages: string[] = []
  for (const { path } of await brease.routes()) {
    const route = await brease.route(path)
    if (!route) continue
    const html = await renderPage(brease, root, route.slug, route.locale)
    if (!html) continue
    const file = outFile(out, path)
    mkdirSync(dirname(file), { recursive: true })
    writeFileSync(file, html)
    pages.push(`/${path.join('/')}`)
  }
  await writeHostOutput(await brease.getRedirects().catch(() => []), out, opts.host ?? detectHost())
  return { pages, out }
}

export type Host = 'vercel' | 'cloudflare' | null

export const detectHost = (): Host =>
  process.env.VERCEL ? 'vercel' : process.env.CF_PAGES || process.env.WORKERS_CI ? 'cloudflare' : null

type VercelJson = {
  redirects?: { source: string; destination: string; permanent?: boolean; statusCode?: number }[]
  rewrites?: { source: string; destination: string }[]
  headers?: { source: string; headers: { key: string; value: string }[] }[]
}

const vercelDest = (destination: string) => destination.replace(/:(\w+)\*?/g, '$$$1')
const vercelRoute = (source: string) => `^${vercelSource(source)}/?$`

// The site's own vercel.json rules as Build Output routes: Build Output replaces vercel.json, so they'd be lost.
export function vercelJsonRoutes(file: string) {
  if (!existsSync(file)) return { before: [], after: [] }
  const cfg = JSON.parse(readFileSync(file, 'utf8')) as VercelJson
  const headers = (cfg.headers ?? []).map((h) => ({
    src: vercelRoute(h.source),
    headers: Object.fromEntries(h.headers.map((x) => [x.key, x.value])),
    continue: true
  }))
  const redirects = (cfg.redirects ?? []).map((r) => ({
    src: vercelRoute(r.source),
    headers: { Location: vercelDest(r.destination) },
    status: r.statusCode ?? (r.permanent === false ? 307 : 308)
  }))
  const rewrites = (cfg.rewrites ?? []).map((r) => ({
    src: vercelRoute(r.source),
    dest: vercelDest(r.destination)
  }))
  return { before: [...headers, ...redirects], after: rewrites }
}

// _redirects (Cloudflare, Netlify) always sits beside the files; on Vercel the build also writes Vercel's Build
// Output (.vercel/output), which carries the redirects as routes, keeps the site's own vercel.json rules and
// serves the same files. `spa`: every unknown path gets index.html, so deep links into a browser-only app work.
export async function writeHostOutput(
  redirects: Redirect[],
  out: string,
  host: Host,
  opts: { spa?: boolean } = {}
) {
  const lines = redirects.map((r) => `${r.source} ${r.destination} ${r.status}`)
  if (opts.spa) lines.push('/* /index.html 200')
  writeFileSync(join(out, '_redirects'), lines.length ? `${lines.join('\n')}\n` : '')
  if (host !== 'vercel') return
  const root = dirname(out)
  const vercel = join(root, '.vercel', 'output')
  rmSync(vercel, { recursive: true, force: true })
  mkdirSync(vercel, { recursive: true })
  cpSync(out, join(vercel, 'static'), { recursive: true })
  const own = vercelJsonRoutes(join(root, 'vercel.json'))
  const routes = redirects.map((r) => ({
    src: vercelRoute(r.source),
    headers: { Location: vercelDest(r.destination) },
    status: r.status
  }))
  const fallback = opts.spa
    ? [{ src: '/(.*)', dest: '/index.html' }]
    : existsSync(join(out, '404.html'))
      ? [{ handle: 'error' }, { src: '/(.*)', dest: '/404.html', status: 404 }]
      : []
  writeFileSync(
    join(vercel, 'config.json'),
    JSON.stringify(
      { version: 3, routes: [...own.before, ...routes, { handle: 'filesystem' }, ...own.after, ...fallback] },
      null,
      2
    )
  )
}

// A Brease redirect source (`/blog/:slug`, `/docs/:rest*`) as a Vercel route pattern with named groups.
export const vercelSource = (source: string) =>
  source
    .split(/(:\w+\*?)/)
    .map((part) =>
      part.startsWith(':')
        ? part.endsWith('*')
          ? `(?<${part.slice(1, -1)}>.*)`
          : `(?<${part.slice(1)}>[^/]+)`
        : part.replace(/[.+?^${}()|[\]\\*]/g, '\\$&')
    )
    .join('')

// Every request rendered from Brease as it is now: the editor's preview shows an edit after a reload, with no
// rebuild. The site's other files are served from the repository.
export function serve(brease: Brease, opts: { root?: string; port?: number } = {}) {
  const root = opts.root ?? process.cwd()
  const server = createServer(async (req, res) => {
    try {
      const url = new URL(req.url ?? '/', 'http://localhost')
      const pathname = decodeURIComponent(url.pathname)
      const asset = join(root, pathname)
      const rel = relative(root, asset)
        .split(/[\\/]+/)
        .join('/')
      if (
        !rel.startsWith('..') &&
        isPublicAsset(rel, referencedAssets(root)) &&
        existsSync(asset) &&
        statSync(asset).isFile()
      ) {
        res.writeHead(200, {
          'content-type': MIME[extname(asset).toLowerCase()] ?? 'application/octet-stream'
        })
        res.end(readFileSync(asset))
        return
      }
      const hit = matchRedirect(await brease.getRedirects().catch(() => []), pathname)
      if (hit) {
        res.writeHead(hit.status, { location: hit.destination })
        res.end()
        return
      }
      const route = await brease.route(pathname.split('/').filter(Boolean))
      const html = route && (await renderPage(brease, root, route.slug, route.locale))
      res.writeHead(html ? 200 : 404, { 'content-type': MIME['.html'] as string })
      res.end(html ?? 'Not found')
    } catch (err) {
      res.writeHead(500, { 'content-type': 'text/plain' })
      res.end(`Brease couldn't render this page: ${(err as Error).message}`)
    }
  })
  server.listen(opts.port ?? Number(process.env.PORT ?? 3000))
  return server
}

// For apps that render in the browser (a Vite SPA): everything they show, read at build time and written as
// JSON the app imports, so no token reaches the browser. { site, pages: { <locale>: { <slug>: page } },
// navigations: { <locale>: { <key>: navigation } }, global: { <locale>: page } }.
export async function exportContent(brease: Brease, navigationKeys: string[] = []) {
  const site = await brease.getSite()
  const pages: Record<string, Record<string, Page>> = {}
  const navigations: Record<string, Record<string, Navigation | null>> = {}
  const global: Record<string, Page | null> = {}
  for (const locale of site.locales) {
    pages[locale] = {}
    for (const ref of await brease.getPages({ locale })) {
      const page = await brease.getPage(ref.slug, { locale })
      if (page) (pages[locale] as Record<string, Page>)[ref.slug] = page
    }
    navigations[locale] = Object.fromEntries(
      await Promise.all(
        navigationKeys.map(async (k) => [k, await brease.getNavigation(k, { locale }).catch(() => null)])
      )
    )
    global[locale] = await brease.getPage('_global', { locale }).catch(() => null)
  }
  return { site, pages, navigations, global, redirects: await brease.getRedirects().catch(() => []) }
}

export function writeJson(file: string, value: unknown) {
  mkdirSync(dirname(file), { recursive: true })
  writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`)
}
