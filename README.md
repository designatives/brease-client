# brease-client

Typed client for the Brease delivery API. Zero runtime dependencies, ESM + CJS, runs on Node 18+, edge runtimes, Deno, Bun and browsers.

```sh
pnpm add brease-client
```

Set two environment variables (Brease writes them into your Vercel project at onboarding):

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

await brease.getSite() // name, locales, defaultLocale, localeStrategy, global SEO
await brease.getPage<Home>('', { locale: 'en' }) // Page<Home> | null ('' is the home page)
await brease.getPages({ locale: 'en' }) // [{ pageId, locale, slug, url, hidden }]
await brease.getNavigation('main', { locale: 'en' }) // { key, locale, items } | null
await brease.getRedirects() // [{ source, destination, status }]
await brease.resolve('/en/about') // { slug: 'about', locale: 'en' } | null
await brease.route(['en', 'about']) // the same from catch-all path segments; null for shared "_" pages
await brease.routes() // [{ path: ['en', 'about'] }, …]: static params for every published page
await brease.localeContext(['en', 'about']) // { locale, settings, alternates, homes } for BreaseLocaleProvider
await brease.sitemap('https://example.com') // [{ url, alternates }]
```

- `null` means 404. Every other failure throws a `BreaseError` with `status`, `code`, `requestId` and `details`.
- 429 and 5xx responses (and network errors) are retried twice with backoff; `Retry-After` is honoured.
- Commit pinning: the `x-brease-commit` header is sent from `VERCEL_GIT_COMMIT_SHA`, so every deployment reads the content release that was built and tested with its code.
- `sitemap()` has no `lastModified`: releases are immutable snapshots and do not track per-page edit times.
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
  const pages = await brease.getPages()
  return pages.filter((p) => !p.hidden).map((p) => ({ slug: p.url.split('/').filter(Boolean) }))
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
// app/api/revalidate/route.ts
import { revalidateHandler } from 'brease-client/next'

export const POST = revalidateHandler() // uses BREASE_REVALIDATE_SECRET
```

```ts
// next.config.ts: redirects managed in Brease
import { createBrease } from 'brease-client'

export default {
  async redirects() {
    const redirects = await createBrease().getRedirects()
    return redirects.map((r) => ({ source: r.source, destination: r.destination, permanent: r.status === 301 || r.status === 308 }))
  }
}
```

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
- `next.config`: `redirects: breaseRedirects()` (from `brease-client/next`) serves the redirects managed in Brease.

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

- `data-brease="hero.title"` on an element that renders a page content field (a path into `page.content`)
- `data-brease="nav:footer"` on the element that wraps a navigation menu; clicking it opens that navigation's editor

```tsx
<nav data-brease="nav:footer">{footer.items.map(/* … */)}</nav>
```

## Images

```ts
import { imageProps, srcset } from 'brease-client/image'

const props = imageProps(page.content.hero.image, { sizes: '(min-width: 768px) 50vw, 100vw' })
// <img src={props.src} srcSet={props.srcSet} sizes={props.sizes} />
```

Brease files are served as-is from an S3 bucket, which doesn't resize images: the helpers return the URL unchanged with an empty `srcset`. For responsive images, let your framework resize them, e.g. `next/image` with the bucket's host in `images.remotePatterns`.

## Without JavaScript

Every call is a plain REST request:

```sh
curl -H "Authorization: Bearer $BREASE_TOKEN" "https://api.brease.io/content-api/page?slug=about&locale=en"
```

Routes: `GET /content-api/site`, `/content-api/pages?locale=`, `/content-api/page?slug=&locale=`, `/content-api/navigations/:key?locale=`, `/content-api/redirects`, `/content-api/release`.
