# Per framework

The shape of each setup. The code itself comes from `node_modules/brease-client/README.md` (the section named in
each entry) and the linked docs page: they match the installed version, this file doesn't.

All docs pages are also available as Markdown: replace `https://docs.brease.io/docs/` with
`https://docs.brease.io/llms.mdx/docs/`.

## Next.js, App Router (README: "Next.js (App Router)")
- `src/lib/brease.ts`: `createBrease({ fetch: breaseFetch() })` from `brease-client` and `brease-client/next`.
- One optional catch-all `app/[[...path]]/page.tsx`: `brease.route()`, `getPage()`, `generateStaticParams` from
  `brease.routes()` (throws in production builds when Brease is unreachable, returns `[]` when `BREASE_PREVIEW`
  is set), `generateMetadata` with `toMetadata(page.resolvedSeo)`, `revalidate = 60`.
- `app/api/brease/revalidate/route.ts`: `export const POST = revalidateHandler()`.
- Redirects in `proxy.ts` (Next 16) or `middleware.ts`: `matchRedirect(await brease.getRedirects().catch(() => []), path)`.
- `app/sitemap.ts` with `brease.sitemap(site.url)`; `next.config` `images.remotePatterns` allows `media.brease.io`.
- Docs: [Integrate a site](https://docs.brease.io/docs/developers/integrate-a-site),
  [Locales and routing](https://docs.brease.io/docs/developers/locales-and-routing).

## Next.js, Pages Router
- One optional catch-all `pages/[[...path]].tsx` with `getStaticPaths` / `getStaticProps` (ISR, `revalidate: 60`),
  a revalidate API route that calls `res.revalidate(path)` for the released paths, redirects in middleware.

## Astro (README: "Astro")
- Static output (default): one `src/pages/[...path].astro` with `getStaticPaths()` from `brease.routes()`; a publish
  rebuilds the site. `brease-client output dist` after the build writes the host's redirects.
- Server output (an adapter): `export const prerender = false`, the page reads per request and sends
  `pageCacheControl()`; redirects in `src/middleware.ts`.
- Head: `breaseHead` from `brease-client/astro`.

## SvelteKit
- One rest route `src/routes/[...path]/+page.server.ts` reads the page on the server and applies redirects.
- With `adapter-static`: prerender every page (`entries` from `brease.routes()`); a publish rebuilds the site.
- Otherwise rendered per request with `pageCacheControl()`.

## Nuxt 3
- A server route reads the page (the token stays in Nitro); one catch-all page renders it with `useFetch`;
  a server middleware applies redirects; responses send `pageCacheControl()`.

## React Router v7 / Remix
- A splat route's loader reads the page on the server and applies redirects; `meta` comes from the page's SEO;
  loaders' responses send `pageCacheControl()`.

## SolidStart / Qwik City
- A catch-all route reads the page on the server (`"use server"` query / `routeLoader$`) and applies redirects.

## Vite single-page app, React without a server (README: "Single-page apps")
- `brease-client content src/brease/content.json` before `dev` and `build` (`--watch` in dev) writes every page,
  menu and the site-wide page per locale; the app imports the file, so no token reaches the browser.
- After `vite build`: `brease-client output dist --spa`. A publish rebuilds the site.

## Angular
- Same as single-page apps: `brease-client content src/brease/content.json` before serve and build, a service
  hands it to components. Output folder is `dist/<project>/browser` (Angular 17+) or `dist/<project>`.

## Static HTML (README: "Static HTML sites")
- Move each kind of page into `templates/` (`home.html`, `page.html`, `<template>.html`), keep CSS/JS/images as
  they are, mark content with `data-brease`, put `<!-- brease:head -->` in `<head>`.
- `package.json` scripts: `"build": "brease-client build"`, `"dev": "brease-client serve"`. Output in `dist/`.
- Menus: `data-brease="nav:main"`; language switcher: `data-brease="locales"`; active item:
  `data-brease-current-class`.

## Sites not built with JavaScript (PHP, WordPress themes, Hugo, Jekyll)
- They become static HTML sites built with `brease-client build`: the rendered HTML of each kind of page becomes a
  template. Keep URLs the same; add redirects for any that change.

## Another framework
- Find where it loads data on the server or at build time and read pages there with brease-client, never in the
  browser with the token. Renders per request → read per request, send `pageCacheControl()`, apply redirects.
  Builds static files → read every page at build time and run `brease-client output <folder>`.
