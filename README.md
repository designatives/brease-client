# brease-client

Typed client for the Brease delivery API. Zero runtime dependencies, ESM + CJS, runs on Node 18+, edge runtimes, Deno, Bun and browsers.

```sh
pnpm add brease-client
```

Set these environment variables (Brease writes them into your Vercel or Cloudflare project at onboarding):

| Variable | Purpose |
| --- | --- |
| `BREASE_TOKEN` | Read-only delivery token (`brs_live_…`). It identifies the site. Brease writes two: a production token for production builds, which reads only published content, and a preview token for preview and development, which also reads the draft content of a known commit or draft branch. Keep both on the server. |
| `BREASE_API_URL` | Optional. Defaults to `https://api.brease.io`. Inside a Brease sandbox it points at the local content server. |
| `BREASE_REVALIDATE_SECRET` | ISR/SSR sites only: secret for the revalidate route. |

## Getting started

For an existing Next.js site (other frameworks follow the same steps; see [Astro](#astro) and [Plain HTML](#plain-html--other-servers)):

1. Connect the site in Brease. Onboarding writes the variables above into the hosting project; copy them into `.env.local` for local development.
2. Create the client in `lib/brease.ts` with `breaseFetch()` ([Next.js](#nextjs-app-router)).
3. Render every page from one catch-all route: `brease.route(path)`, then `getPage(slug, { locale })`, with `generateStaticParams = () => brease.routes()`.
4. Move the texts, images and links editors should change into the page's content, in the shapes under [Content links](#content-links) and [Images](#images). Shared parts go on the site-wide `_global` page; menus come from `getNavigation()`.
5. Add [editor markers](#editor-markers) (`data-brease`) to the elements that show content.
6. Render SEO with `toMetadata(page.resolvedSeo)`, plus [`jsonLd`](#structured-data-json-ld) and [`customTags`](#custom-code).
7. Add the revalidate route and the redirects proxy (both under [Next.js](#nextjs-app-router)).
8. Add a `BREASE.md` that tells Brease's AI how the site is built. Brease counts a site as integrated only when the repo has both `brease-client` and `BREASE.md`.
9. Optional: [sections](#sections) and `content.schema.json`. Then run `npx brease-client check`.

On Vercel, Cloudflare Workers Builds and Cloudflare Pages, the client picks up the commit and branch being built on its own (see commit pinning below), so every build reads the content released with its commit.

## API

```ts
import { createBrease } from 'brease-client'

const brease = createBrease({
  token: process.env.BREASE_TOKEN, // default
  apiUrl: process.env.BREASE_API_URL, // default, falls back to https://api.brease.io
  commit: process.env.VERCEL_GIT_COMMIT_SHA, // default (or WORKERS_CI_COMMIT_SHA, CF_PAGES_COMMIT_SHA); false disables commit pinning
  branch: process.env.VERCEL_GIT_COMMIT_REF, // default (or WORKERS_CI_BRANCH, CF_PAGES_BRANCH); only Brease draft branches (brease/draft/…) are sent
  fetch // optional custom fetch, e.g. to add framework cache options
})

await brease.getSite() // name, url (the public address), locales, defaultLocale, localeStrategy, global SEO, analytics
await brease.getPage<Home>('', { locale: 'en' }) // Page<Home> | null ('' is the home page)
await brease.getPages({ locale: 'en' }) // [{ pageId, locale, slug, url, hidden, name, index, parentId, order, template }]
await brease.getPages({ locale: 'en', parentId: news.pageId, withContent: true }) // a news list, with each page's content
await brease.getPages({ locale: 'en', parentId: null }) // top-level pages only
await brease.getNavigation('main', { locale: 'en' }) // { key, locale, items } | null
await brease.getRedirects() // [{ source, destination, status }], cached for a minute
await brease.resolve('/en/about') // { slug: 'about', locale: 'en' } | null
await brease.route(['en', 'about']) // the same from catch-all path segments; null for shared "_" pages
await brease.routes() // [{ path: ['en', 'about'] }, …]: static params for every published page
await brease.localeContext(['en', 'about']) // { locale, settings, alternates, homes } for BreaseLocaleProvider
await brease.sitemap(site.url) // [{ url, alternates }]: pages search may show
```

- `null` means 404. Every other failure throws a `BreaseError` with `status`, `code`, `requestId` and `details`.
- 429 and 5xx responses (and network errors) are retried twice with backoff; `Retry-After` is honoured.
- Commit pinning: the `x-brease-commit` header is sent from the commit the host is building (`VERCEL_GIT_COMMIT_SHA` on Vercel, `WORKERS_CI_COMMIT_SHA` on Cloudflare Workers Builds, `CF_PAGES_COMMIT_SHA` on Cloudflare Pages), so every deployment reads the content release that was built and tested with its code. On a Brease draft branch the `x-brease-branch` header (from the same host's `VERCEL_GIT_COMMIT_REF`, `WORKERS_CI_BRANCH` or `CF_PAGES_BRANCH`) lets later commits there, such as a developer's fix, still read the draft's content. Drafts need a preview token: with a production token a draft's commit or branch reads the live release. These are build-time variables: pages rendered at request time on Cloudflare read the live release unless you pass `commit` yourself.
- `sitemap()` lists only pages search may show: not hidden, not kept out of search (`index: false`, the page's "Show in search results" switch), and no site-wide `_` pages. It has no `lastModified`: releases are immutable snapshots and do not track per-page edit times.
- `getPages({ parentId, template, withContent })` narrows the list to a page's children or one template, and with
  `withContent` adds each page's content (one locale, hidden pages left out, up to 100 pages): build news, team or
  job lists from it instead of fetching every page.
- `site.url` is the site's public address (its primary domain), the one Brease uses in canonical URLs and hreflang; use it for the sitemap and `metadataBase` rather than an env variable of your own.
- `getSite()` and `getRedirects()` are cached in memory for a minute, so a locale added in Brease is served without a restart. The revalidate route (`revalidateHandler`) clears that cache on a publish, but only in the server instance that received the call; other instances (serverless functions, edge regions) catch up within the minute. The editor's preview (`BREASE_PREVIEW=1`) never caches it.
- `getRelease()` throws a `BreaseError` with status 404 until the site's first release is published: there is no release to report yet.
- `buildPath(settings, slug, locale)` and `resolvePath(settings, pathname)` are exported for routing code that already has the site settings.

## Next.js (App Router)

```ts
// lib/brease.ts
import { createBrease } from 'brease-client'
import { breaseFetch } from 'brease-client/next'

export const brease = createBrease({ fetch: breaseFetch() }) // tags requests with 'brease'
```

```tsx
// app/[[...slug]]/page.tsx
import { notFound } from 'next/navigation'
import { toMetadata } from 'brease-client/next'
import { brease } from '@/lib/brease'

export const revalidate = 60

type Props = { params: Promise<{ slug?: string[] }> }

async function load(params: Props['params']) {
  const { slug = [] } = await params
  const target = await brease.resolve(`/${slug.join('/')}`)
  return target ? brease.getPage<{ hero: { title: string } }>(target.slug, { locale: target.locale }) : null
}

export async function generateStaticParams() {
  // The build goes on without pre-rendered pages if the content API has a hiccup; pages then render on first request.
  try {
    return (await brease.routes()).map((r) => ({ slug: r.path })) // published pages, without site-wide "_" pages
  } catch (err) {
    console.warn(`Brease pages unavailable at build time: ${(err as Error).message}`)
    return []
  }
}

export async function generateMetadata({ params }: Props) {
  const page = await load(params)
  return page ? toMetadata(page.resolvedSeo) : {}
}

export default async function Page({ params }: Props) {
  const page = await load(params)
  if (!page) notFound()
  return <h1 data-brease="hero.title">{page.content.hero.title}</h1>
}
```

`page.resolvedSeo` is final: the title already has the site's title template applied (unless the page chose to show
its title as written), and every field falls back to the site's defaults. Render it as is; don't add your own
template or a home-page exception in code.

```ts
// app/api/brease/revalidate/route.ts: the path Brease calls after a content release
import { revalidateHandler } from 'brease-client/next'

export const POST = revalidateHandler() // uses BREASE_REVALIDATE_SECRET; refreshes at once
```

Other frameworks: `verifyRevalidate(request, secret)` (root export) checks the signature and returns the paths and
cache tags to refresh, or why not (401 for a bad signature, 400 for a bad body).

Redirects managed in Brease apply per request, so a new one works as soon as it's published (within a minute), with
no rebuild:

```ts
// proxy.ts (middleware.ts before Next 16)
import { type NextRequest, NextResponse } from 'next/server'
import { matchRedirect } from 'brease-client'
import { brease } from '@/lib/brease'

export async function proxy(req: NextRequest) {
  const hit = matchRedirect(await brease.getRedirects().catch(() => []), req.nextUrl.pathname)
  return hit ? NextResponse.redirect(new URL(hit.destination, req.url), hit.status) : NextResponse.next()
}

export const config = { matcher: ['/((?!_next|api|.*\\..*).*)'] }
```

Sources may use parameters as in Next's redirects (`/blog/:slug`, `/docs/:rest*`). `breaseRedirects()` (from
`brease-client/next`, for `next.config`) still works, but only reads redirects at build time.

`route()` also resolves other forms of a page's URL (`/en/about` where English has no prefix, `/about` where every
locale is prefixed); `resolvedSeo.canonical` points search engines at the real one. To redirect those forms too,
add this to the same proxy, before `NextResponse.next()`. Keep it in the `try`: when Brease can't be reached, the
request goes on to the page instead of failing.

```ts
import { canonicalPath } from 'brease-client'

try {
  const canonical = canonicalPath(await brease.getSite(), req.nextUrl.pathname)
  if (canonical && (await brease.getPages()).some((p) => p.url === canonical))
    return NextResponse.redirect(new URL(canonical + req.nextUrl.search, req.url), 308)
} catch {}
```

### Structured data (JSON-LD)

Structured data is content: the page's own entries (its SEO in Brease) and the site's (site SEO) come together in
`page.resolvedSeo.structuredData`. `toMetadata` can't output scripts, so render them with `jsonLd` (framework-free,
from the root export) on every page; each item's `json` is escaped for use inside a script tag. Entities your code
already emits shouldn't be added in Brease too.

```tsx
import { jsonLd } from 'brease-client'

{jsonLd(page.resolvedSeo).map((item, i) => (
  <script key={i} type="application/ld+json" dangerouslySetInnerHTML={{ __html: item.json }} />
))}
```

`headTags` (HTML) and `breaseHead` (Astro) already include it; `jsonLdHtml(seo)` gives only the scripts.

### Custom code

Site-wide head code and a page's own code (both from SEO settings in Brease) run on the live site only when the site
renders them. `toMetadata` can't, so render `customTags(page.resolvedSeo)` (root export) as real elements:

```tsx
import { customTags } from 'brease-client'

{customTags(page.resolvedSeo).map(({ tag: Tag, attrs, content }, i) => {
  const props = Object.fromEntries(Object.entries(attrs).map(([k, v]) => [k, v === '' ? true : v]))
  return content ? <Tag key={i} {...props} dangerouslySetInnerHTML={{ __html: content }} /> : <Tag key={i} {...props} />
})}
```

Only `script`, `style`, `meta`, `link` and `noscript` tags are kept. `headTags` (HTML) and `breaseHead` (Astro)
include the code already.

### Google Analytics (GA4)

When GA4 is linked in Brease (Connections → Google) with "Add the tag to the site" on, the site response carries
its measurement id. Render it once in the root layout; turning it off in Brease removes it without a deploy.

```tsx
// app/layout.tsx
import Script from 'next/script'
import { ga4Tag } from 'brease-client'
import { brease } from '@/lib/brease'

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const ga = ga4Tag(await brease.getSite())
  return (
    <html>
      <body>
        {children}
        {ga && (
          <>
            <Script src={ga.src} strategy="afterInteractive" />
            <Script id="brease-ga4" strategy="afterInteractive">{ga.inline}</Script>
          </>
        )}
      </body>
    </html>
  )
}
```

Consent mode starts denied: nothing is stored until your cookie banner calls `grantAnalytics()` (and
`grantAnalytics(false)` when consent is withdrawn). Without a banner, GA4 only receives cookieless pings. For
Astro or plain HTML, put `ga4Html(site)` in the `<head>`.

### Recommended structure (optional)

Brease works with any routing: `getPage()` and friends don't care how a site is built. This structure is what Brease recommends, and what its editor moves a site towards when the site follows Brease conventions. It makes locales a setting: adding one, or changing how URLs are prefixed, needs no code change.

```
app/
  [[...path]]/
    layout.tsx       root layout: <html lang>, the locale context for the page
    page.tsx         every page in every locale; the page's content picks its template
    not-found.tsx
  og/[[...path]]/route.tsx      share images (image files can't sit inside an optional catch-all)
  api/…, sitemap.ts, robots.ts, other route handlers   unchanged: static routes win over the catch-all
brease/templates.tsx            { home: …, article: … }, the site's own page templates
```

```tsx
// app/[[...path]]/layout.tsx (replaces app/layout.tsx)
import { brease } from '@/lib/brease'
import { LocaleProvider } from '@/components/locale' // the site's own React context around the value

type Props = { children: React.ReactNode; params: Promise<{ path?: string[] }> }

export default async function RootLayout({ children, params }: Props) {
  const site = await brease.getSite()
  const context = (await brease.localeContext((await params).path)) ?? {
    locale: site.defaultLocale,
    settings: site,
    alternates: {},
    homes: {}
  }
  return (
    <html lang={context.locale}>
      <body>
        <LocaleProvider value={context}>{children}</LocaleProvider>
      </body>
    </html>
  )
}
```

```tsx
// app/[[...path]]/page.tsx (replaces app/page.tsx and app/[slug]/page.tsx)
import { notFound } from 'next/navigation'
import { toMetadata } from 'brease-client/next'
import { templates } from '@/brease/templates'
import { brease } from '@/lib/brease'

export const revalidate = 60

type Props = { params: Promise<{ path?: string[] }> }

async function load(params: Props['params']) {
  const route = await brease.route((await params).path)
  const page = route && (await brease.getPage<Content>(route.slug, { locale: route.locale }))
  const Template = page && templates[page.content.template]
  return page && route && Template ? { page, locale: route.locale, Template } : null
}

export async function generateStaticParams() {
  try {
    return await brease.routes()
  } catch (err) {
    console.warn(`Brease pages unavailable at build time: ${(err as Error).message}`)
    return []
  }
}

export async function generateMetadata({ params }: Props) {
  const loaded = await load(params)
  return loaded ? toMetadata(loaded.page.resolvedSeo) : {}
}

export default async function Page({ params }: Props) {
  const loaded = await load(params)
  if (!loaded) notFound()
  // Pass the locale to everything else that reads Brease: navigations, shared "_" pages, site SEO.
  return <loaded.Template page={loaded.page} locale={loaded.locale} />
}
```

The package stays framework-free: it gives the data and the logic, and the site renders them with its own framework.

```ts
import { localeHref, localeLinks } from 'brease-client'

const context = await brease.localeContext(path) // { locale, settings, alternates, homes }
localeLinks(context) // [{ locale: 'hu', label: 'Magyar', href: '/rolunk', current: true }, …]
localeHref(context.settings, 'about', 'de') // '/de/about'
```

A locale switcher is then a few lines in any framework: a list of `<a href={l.href} hreflang={l.locale}>{l.label}</a>`, with `aria-current` on the current one, hidden while `localeLinks()` returns fewer than two links. Share `context` with the components that need it the framework's own way (a React context, Astro props, a template variable).

- `localeLinks()` links each locale's version of the current page, else that locale's home page; locales without content yet are left out, and so are locales the page is left out of on purpose (`context.excluded`, set in Brease's Pages list: those addresses answer "not found").
- Everything that read a fixed locale (`getPage(…, { locale: 'hu' })`, `getNavigation`, `site.seo.hu`) takes it from the route instead.
- Links inside content are already locale URLs. Build other internal links with `localeHref(settings, slug, locale)`.
- Text written into components (button labels, captions) stays as it is; moving it into Brease content is a separate change.
- `proxy.ts`: `matchRedirect(await brease.getRedirects(), pathname)` applies the redirects managed in Brease per request (see above).

### Revalidation signature

After a content-only release goes live, Brease POSTs JSON `{ urls, tags?, releaseId, siteId }` to the site's revalidate URL with two headers:

- `x-brease-timestamp`: milliseconds since epoch
- `x-brease-signature`: hex HMAC-SHA256 of `` `${timestamp}.${rawBody}` `` keyed with the revalidate secret

Requests older than five minutes are rejected. The handler calls `revalidatePath` for each URL's pathname and `revalidateTag` for each tag, always including `brease`.

## Astro

```ts
// src/lib/brease.ts
import { createBrease } from 'brease-client'

export const brease = createBrease({ token: import.meta.env.BREASE_TOKEN, apiUrl: import.meta.env.BREASE_API_URL })
```

```astro
---
// src/pages/[...path].astro
import { breaseHead } from 'brease-client/astro'
import { brease } from '../lib/brease'

// Static output builds one file per published page in every locale. getStaticPaths can only use imports, so the
// client lives in its own module.
export async function getStaticPaths() {
  return (await brease.routes()).map(({ path }) => ({ params: { path: path.join('/') || undefined } }))
}

const route = await brease.route(Astro.params.path)
const page = route && (await brease.getPage(route.slug, { locale: route.locale }))
if (!page) return new Response(null, { status: 404 })
---
<html lang={page.locale}>
  <head><Fragment set:html={breaseHead(page.resolvedSeo)} /></head>
  <body><h1 data-brease="hero.title">{page.content.hero.title}</h1></body>
</html>
```

`headTagList(seo)` returns the same tags as structured `{ tag, attrs, content }` objects.

## Static HTML sites (no framework)

A site made of hand-written HTML pages gets its content from Brease at build time, with its markup, CSS, scripts and
animations untouched. Move each kind of page into `templates/`, mark the content in it, and let `brease-client` build
the site:

```
templates/
  home.html       the home page (slug "")
  page.html       every other page, unless a page names its own template
  room.html       pages whose content has "template": "room"
css/ js/ img/     the site's own files, copied as they are
package.json      "build": "brease-client build", "dev": "brease-client serve"
```

```html
<head>
  <meta charset="utf-8" />
  <!-- brease:head -->  <!-- the page's title, meta, canonical, hreflang, structured data and custom code -->
  <link rel="stylesheet" href="/css/site.css" />
</head>
<body>
  <nav data-brease="nav:main"><a data-brease-item href="/">Home</a></nav>
  <h1 data-brease="hero.title">Welcome</h1>
  <div data-brease="hero.text" data-brease-html><p>Rich text</p></div>
  <img data-brease="hero.image" src="/img/hero.jpg" alt="" />
  <a data-brease="hero.cta" href="/contact">Contact us</a>
  <ul data-brease="rooms">
    <li data-brease-item><h2 data-brease="rooms.0.name">Room</h2></li>
  </ul>
  <p data-brease="_global:footer.copyright">© 2026</p>
</body>
```

- `brease-client build` renders every published page in every locale to `dist/<url>/index.html`, copies the site's other files beside them, and writes Brease's redirects: `dist/_redirects` (Cloudflare) and, on Vercel, Vercel's Build Output (`.vercel/output`). Set the host's output directory to `dist`.
- `brease-client serve` renders each request as it comes in (on `$PORT`): the editor's preview shows an edit after a reload, without a rebuild.
- The `data-brease` markers both place the content and tell the editor what is editable, so they stay in the output. A field with no value keeps the template's own markup.
- Text: the element's text becomes the field (rich text keeps its HTML; mark it `data-brease-html`). Images: on `<img>` the `src`, `alt`, `width` and `height`; on other elements the background image. Links: on `<a>` the `href`, and the label where the link has no child elements.
- Lists and menus: the child marked `data-brease-item` repeats per item; its markers are written for the first item (`rooms.0.name`) and renumbered for the rest. In a menu (`nav:<key>`), the item's `<a>` gets the menu item's address and label (or the elements marked `data-brease-label` get the label).
- `_global:<path>` reads the site-wide page; the output carries that page's id, as the editor expects.
- New content goes live when Brease rebuilds the site after a publish.

`renderTemplate(html, { page, global, navigations })` (root export) does the filling, for other build setups.
`headTags(seo)` from `brease-client/html` returns the head tags alone.

## Single-page apps (Vite, React without a server)

An app that renders in the browser reads its content at build time, so no token reaches the browser:

```json
{
  "scripts": {
    "dev": "brease-client content src/brease/content.json --nav main,footer --watch & vite",
    "build": "brease-client content src/brease/content.json --nav main,footer && vite build && brease-client output dist"
  }
}
```

```ts
import content from './brease/content.json'

const page = content.pages[locale]?.[slug] // the same page object getPage() returns
const menu = content.navigations[locale]?.main
const global = content.global[locale]
```

- `content.json` holds `{ site, pages: { <locale>: { <slug>: page } }, navigations, global, redirects }`. `--watch` rewrites it while the editor's preview runs, so the dev server shows edits.
- Mark elements with `data-brease` as in every other framework (see Editor markers).
- `brease-client output dist` writes the redirects for the host (`dist/_redirects`, or Vercel's Build Output on Vercel). Keep the SPA's own fallback to `index.html`.
- New content goes live when Brease rebuilds the site after a publish.

## Other frameworks

Every site reads its content the same way: `createBrease()` on the server or at build time (never in the browser,
where the token would be public), `route()` and `getPage()` for the page of a URL, `routes()` to list every page in
every locale, `matchRedirect()` for redirects on servers that answer each request. Per framework:

- **SvelteKit**: a rest route `src/routes/[...path]/+page.server.ts` whose `load` calls `brease.route(params.path)` and
  `getPage`, returns `headTags(page.resolvedSeo)` for `<svelte:head>`, and redirects with `matchRedirect`. With
  `adapter-static`, export `entries` from `brease.routes()` so every page prerenders.
- **Nuxt 3**: a server route (`server/api/brease/page.get.ts`) reads the page in Nitro, `pages/[...slug].vue` loads it
  with `useFetch`, and a server middleware applies `matchRedirect` with `sendRedirect`.
- **React Router v7 / Remix**: the splat route `app/routes/$.tsx` reads the page in its `loader` (a `.server.ts`
  module holds the client), `meta` maps `headTagList(page.resolvedSeo)`.
- **SolidStart**: a catch-all route reads the page through a `query` with `"use server"`.
- **Qwik City**: `routeLoader$` in `src/routes/[...path]/index.tsx`, `head` from the page's SEO.
- **Gatsby**: `createPages` in `gatsby-node.ts` creates a page per `routes()` entry with the page in its context, and
  `createRedirect` for each redirect; the template's `Head` maps `headTagList`.
- **Eleventy**: a global data file (`_data/brease.js`) returns every page with `headTags`, and one template paginates
  over it with `permalink: "{{ item.page.url }}"`.
- **Angular, Create React App, Vue CLI, webpack apps**: like Vite single-page apps, `brease-client content` writes
  the content JSON before every serve and build (npm `pre` scripts), and `brease-client output <dir>` writes the host's
  redirects after the build.
- **Node servers (Express, Hono, Fastify, Koa)**: a middleware applies `matchRedirect`, one catch-all route reads the
  page per request and renders it with the site's own templates and `headTags`.
- **Any other JavaScript framework**: find where it loads data on the server or at build time and read Brease there;
  a client-only app uses `brease-client content`.
- **Sites not built with JavaScript (Hugo, Jekyll, Hexo, PHP, other server templates)**: they become static sites
  built from Brease. Their rendered HTML becomes the templates (see Static HTML sites), `brease-client build`
  replaces the old generator's build, and the content moves from Markdown and data files into Brease.

## Editor markers

The Brease editor's Edit tool finds content through `data-brease` attributes:

- `data-brease={fieldPath('hero.title')}` on an element that renders a field of the page being shown (a path into `page.content`, e.g. `hero.title` or `sections.2.items.0.label`)
- `data-brease={fieldPath('footer.copyright', global.pageId)}` for a field of another page, such as site-wide content (`_global`): the path is prefixed with that page's id (`<pageId>:footer.copyright`). Take the id from the page you fetched, never a fixed one.
- `data-brease={navPath('footer')}` (`nav:footer`) on the element that wraps a navigation menu; clicking it opens that navigation's editor
- `data-brease-block`: a section root carries its section type (`{section.type}`); other blocks (header, footer, a hero outside the sections list) carry their component name. A hint for the AI.
- `data-brease-sections="sections"` and `data-brease-section="<id>"`: the section list and its sections (see Sections)

```tsx
import { fieldPath, navPath } from 'brease-client'

<nav data-brease={navPath('footer')}>{footer.items.map(/* … */)}</nav>
<p data-brease={fieldPath('footer.copyright', global.pageId)}>{global.content.footer.copyright}</p>
```

## Sections

Editors can add, move, duplicate and delete page sections in the Brease editor when a site follows the sections convention:

```
src/brease/sections/          (or brease/sections/)
  index.tsx                   type -> component map, renders content.sections in order; unknown types render nothing
  testimonials/
    section.json              { "name": "Testimonials", "description": "…", "addable": true, "fields": { JSON Schema } }
    Testimonials.tsx
```

- A page's sections are one list, `content.sections: [{ id, type, ...fields }]`, with the same ids in the same order in every locale. Fixed parts (a page title, header, footer, site-wide content) stay outside it.
- `fields` describes the section's fields; Brease builds new sections from it (lorem ipsum, a placeholder image, `default`s, `enum`s' first values, `minItems` list items). Images are `{ assetId, url, alt, width?, height? }` (`BreaseImage`), links `{ label, href }` (`BreaseLink`; an internal link also carries the page's `pageId`, and the delivery API sets its `href` for the requested locale), rich text `{ "type": "string", "format": "html" }`.
- `"shared": true` keeps one content for every page that shows the type, on the site-wide page (`_global`) under `content.shared.<type>`; pages list only `{ id, type }` for it, and its markers use the other-page prefix (`<_global pageId>:shared.<type>.<field>`).
- Markers: the list's element carries `data-brease-sections="sections"`, each section's root `data-brease-section={id}` and `data-brease-block={type}`, fields inside `data-brease="sections.<index>.<field>"`.

```tsx
import { type BreaseSection, sectionAttrs, sectionsAttrs } from 'brease-client'

export function Sections({ sections }: { sections: BreaseSection[] }) {
  return (
    <div {...sectionsAttrs}>
      {sections.map((s, i) => {
        const Component = map[s.type]
        return Component ? <div key={s.id} {...sectionAttrs(s)}><Component section={s} index={i} /></div> : null
      })}
    </div>
  )
}
```

`npx brease-client check` warns about folders without a valid `section.json`, types missing from the map file, a missing `data-brease-section`, unknown types in `brease-seed/` or `.brease/` content, and locales whose sections differ. Brease runs the same check before publishing.

## Images

```ts
import { imageProps } from 'brease-client/image'

const props = imageProps(page.content.hero.image)
// <img src={props.src} alt={props.alt} width={props.width} height={props.height} />
```

An image field is `{ assetId, url, alt, width?, height? }` (`BreaseImage`); `imageProps` takes the field or a plain
URL. Brease files are served as-is from storage, which doesn't resize images: the helpers return the URL unchanged,
without `srcSet` or `sizes` (the resize options are ignored). For responsive images, let your framework resize them, e.g. `next/image` with the host of
your Brease image URLs in `images.remotePatterns`.

## Content links

Link fields are `{ label, href }`. A link to another page of the site also carries that page's `pageId`, and the
delivery API sets `href` to the page's URL in the locale you asked for, so renaming or moving a page never breaks a
link and every locale links to its own version. External links are only the `href`. Rich text links to pages carry
`data-brease-page="<pageId>"`, and their `href` is filled in the same way.

## Without JavaScript

Every call is a plain REST request:

```sh
curl -H "Authorization: Bearer $BREASE_TOKEN" "https://api.brease.io/content-api/page?slug=about&locale=en"
```

| Route | Query | Returns |
| --- | --- | --- |
| `GET /content-api/site` | | `{ name, url, locales, defaultLocale, localeStrategy, urlTemplate, seo: { <locale>: … }, analytics }` |
| `GET /content-api/pages` | `locale`, `parentId`, `template`, `withContent` | `[{ pageId, locale, slug, url, hidden, name, index, parentId, order, template, content? }]` |
| `GET /content-api/page` | `slug`, `locale` | one page (below); 404 when missing or hidden |
| `GET /content-api/navigations/:key` | `locale` | `{ key, locale, items: [{ id, label, url, pageId?, target?, children }] }` |
| `GET /content-api/redirects` | | `[{ source, destination, status }]` |
| `GET /content-api/release` | | `{ id, number, commitSha, liveAt }` of the release served; 404 before the first publish |
| `GET /content-api/openapi.json` | | the OpenAPI document |

A page:

```json
{
  "pageId": "pg_about",
  "name": "About",
  "locale": "en",
  "slug": "about",
  "url": "/about",
  "hidden": false,
  "content": {
    "template": "page",
    "title": "About us",
    "image": { "assetId": "ast_…", "url": "https://…/team.webp", "alt": "Our team", "width": 2400, "height": 1600 },
    "cta": { "label": "Contact us", "href": "/contact", "pageId": "pg_contact" }
  },
  "seo": { "title": "About us" },
  "resolvedSeo": {
    "title": "About us – Acme",
    "canonical": "https://www.acme.com/about",
    "robots": { "index": true, "follow": true },
    "openGraph": { "title": "About us – Acme" },
    "twitter": {},
    "structuredData": [],
    "alternates": { "en": "https://www.acme.com/about", "de": "https://www.acme.com/de/ueber-uns" }
  },
  "alternates": { "de": "/de/ueber-uns" }
}
```

`content` is the page's own JSON. `seo` is what the page sets; `resolvedSeo` has the site's defaults and title template applied, so render it as is.

Requests take `x-brease-commit` and `x-brease-branch` (see commit pinning above) and `If-None-Match`; responses carry `ETag`, `x-brease-release` and `Cache-Control: public, s-maxage=60, stale-while-revalidate=300`. Errors are `{ "error": { "code", "message" } }`: 401 `unauthorized`, 404 `not_found`, 422 `validation`, 429 `rate_limited` (with `Retry-After`).
