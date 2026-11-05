# brease-client

Typed client for the Brease delivery API. Zero runtime dependencies, ESM + CJS, runs on Node 18+, edge runtimes, Deno, Bun and browsers.

```sh
pnpm add brease-client
```

Set these environment variables (Brease writes them into your Vercel project at onboarding):

| Variable | Purpose |
| --- | --- |
| `BREASE_TOKEN` | Read-only delivery token (`brs_live_…`). It identifies the site. |
| `BREASE_API_URL` | Optional. Defaults to `https://api.brease.io`. Inside a Brease sandbox it points at the local content server. |
| `BREASE_REVALIDATE_SECRET` | ISR/SSR sites only: secret for the revalidate route. |

## API

```ts
import { createBrease } from 'brease-client'

const brease = createBrease({
  token: process.env.BREASE_TOKEN, // default
  apiUrl: process.env.BREASE_API_URL, // default, falls back to https://api.brease.io
  commit: process.env.VERCEL_GIT_COMMIT_SHA, // default; false disables commit pinning
  fetch // optional custom fetch, e.g. to add framework cache options
})

await brease.getSite() // name, url (the public address), locales, defaultLocale, localeStrategy, global SEO, analytics
await brease.getPage<Home>('', { locale: 'en' }) // Page<Home> | null ('' is the home page)
await brease.getPages({ locale: 'en' }) // [{ pageId, locale, slug, url, hidden, name, index, parentId, order }]
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
- Commit pinning: the `x-brease-commit` header is sent from `VERCEL_GIT_COMMIT_SHA`, so every deployment reads the content release that was built and tested with its code.
- `sitemap()` lists only pages search may show: not hidden, not kept out of search (`index: false`, the page's "Show in search results" switch), and no site-wide `_` pages. It has no `lastModified`: releases are immutable snapshots and do not track per-page edit times.
- `site.url` is the site's public address (its primary domain), the one Brease uses in canonical URLs and hreflang; use it for the sitemap and `metadataBase` rather than an env variable of your own.
- `getSite()` is cached for a minute, so a locale added in Brease is served without a restart.
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
  return (await brease.routes()).map((r) => ({ slug: r.path })) // published pages, without site-wide "_" pages
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

export const generateStaticParams = () => brease.routes()

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

- `localeLinks()` links each locale's version of the current page, else that locale's home page; locales without content yet are left out.
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

```astro
---
import { createBrease } from 'brease-client'
import { breaseHead } from 'brease-client/astro'

const brease = createBrease({ token: import.meta.env.BREASE_TOKEN, apiUrl: import.meta.env.BREASE_API_URL })
const target = await brease.resolve(Astro.url.pathname)
const page = target && (await brease.getPage(target.slug, { locale: target.locale }))
if (!page) return Astro.redirect('/404')
---
<html lang={page.locale}>
  <head><Fragment set:html={breaseHead(page.resolvedSeo)} /></head>
  <body><h1 data-brease="hero.title">{page.content.hero.title}</h1></body>
</html>
```

`headTagList(seo)` returns the same tags as structured `{ tag, attrs, content }` objects.

## Plain HTML / other servers

```ts
import { headTags } from 'brease-client/html'

const html = `<head>${headTags(page.resolvedSeo, { xDefault: 'https://example.com/' })}</head>`
```

`customHead` and `customCode` from the site's SEO settings are inserted as raw HTML (they are authored by the site's team); pass `{ includeCustom: false }` to leave them out.

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
import { imageProps, srcset } from 'brease-client/image'

const props = imageProps(page.content.hero.image, { sizes: '(min-width: 768px) 50vw, 100vw' })
// <img src={props.src} srcSet={props.srcSet} sizes={props.sizes} alt={props.alt} width={props.width} height={props.height} />
```

An image field is `{ assetId, url, alt, width?, height? }` (`BreaseImage`); `imageProps` takes the field or a plain
URL. Brease files are served as-is from storage, which doesn't resize images: the helpers return the URL unchanged
with an empty `srcset`. For responsive images, let your framework resize them, e.g. `next/image` with the host of
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

Routes: `GET /content-api/site`, `/content-api/pages?locale=`, `/content-api/page?slug=&locale=`, `/content-api/navigations/:key?locale=`, `/content-api/redirects`, `/content-api/release`.
