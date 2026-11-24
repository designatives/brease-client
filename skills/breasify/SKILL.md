---
name: breasify
description: Make an existing website ready for Brease (the AI CMS) so its content is edited in Brease. Use when the user asks to "breasify" a site, set a site up for Brease, integrate brease-client, or prepare a repository before connecting it in Brease's setup. Works on Next.js, Astro, SvelteKit, Nuxt, Remix/React Router, Vite single-page apps, Angular and plain HTML sites.
---

# Breasify a site

You turn the site in the current repository into one whose editable content comes from Brease, without changing
how it looks. When you're done, the person connects the repository in Brease's setup and its **Final checks** step
confirms your work.

Work in small steps, run the site's own checks as you go, and keep the site's design, markup and behaviour as they
are. Read [references/checklist.md](references/checklist.md) first: it is what Brease checks at the end.

## 0. Stop early when Brease can't take the site

Brease doesn't convert sites whose core is a shop (cart, checkout), user accounts (sign-up, log-in, member areas) or
comments. If the site depends on one of these, tell the person and stop; don't half-convert it. A contact form,
newsletter form or booking embed is fine: keep it as it is.

## 1. Look before changing anything

- Framework and version: `package.json` dependencies and the config file (`next.config.*`, `astro.config.*`,
  `svelte.config.*`, `nuxt.config.*`, `vite.config.*`, `angular.json`). No `package.json` and only HTML files:
  a static site.
- Package manager: `pnpm-lock.yaml` → pnpm, `yarn.lock` → yarn, `bun.lock(b)` → bun, else npm. Use that one only.
- Where pages get their text and images today (hard-coded in components, Markdown files, a CMS API, JSON).
- The languages the site has, and how its URLs show them (`/en/about`, `/about` for the default language, …).
- Make a branch (`git switch -c brease-setup`) unless the person said otherwise. Never push to the main branch
  without the person's say.

## 2. Install brease-client

Install the newest version with the site's package manager, for example `pnpm add brease-client`. A site with no
`package.json` (plain HTML, PHP) gets one first: `{ "private": true, "scripts": { "build": "brease-client build",
"dev": "brease-client serve" } }` and npm. Make sure `.gitignore` has `node_modules/`, the build folder (`dist/`)
and `.env.local`.

If the install fails with `ERR_PNPM_MINIMUM_RELEASE_AGE_VIOLATION` (the site only accepts packages older than a
cut-off and brease-client was released recently), add brease-client to the exceptions in `pnpm-workspace.yaml`
and install again:

```yaml
minimumReleaseAgeExclude:
  - brease-client
```

Then read `node_modules/brease-client/README.md`. **It is the API reference for the installed version**: function
names, options and the recipe for this framework. Prefer it over anything you remember, and over this skill where
the two differ.

## 3. Wire content reading for the framework

Follow the framework's recipe in the README and [references/frameworks.md](references/frameworks.md). The rules
that hold everywhere:

- One route renders every page in every language (a catch-all), using `brease.route()` to turn a URL into a page
  and a language. Remove the routes it replaces.
- The token (`BREASE_TOKEN`) is read on the server or at build time only. Never in browser code, never in a
  committed file. Put it in `.env.local` (git-ignored) for local runs; Brease's setup writes it into the hosting
  project.
- A production build fails when Brease can't be reached (so the host keeps the live version); the editor's preview
  (`BREASE_PREVIEW=1`) carries on without pages. The README's recipes do this; keep it when you adapt them.
- Pages rendered on every request send `pageCacheControl()` as their `Cache-Control` header.
- New content goes live without a code change: the Next.js revalidate route (`revalidateHandler()`), or a rebuild on
  publish for static output.
- Redirects managed in Brease apply per request (`matchRedirect`) or are written next to the built files
  (`brease-client output <dir>`).
- More than one language: the language switcher uses `localeLinks()` (static HTML: the `data-brease="locales"`
  marker), and pages may be left out of a language on purpose.

## 4. Move the content into Brease's shape

Decide each page's content shape: plain fields for one-off pages, a `sections` list where editors should add, move
and remove blocks. Things every page shares (header and footer texts, contact details) go on the site-wide page,
slug `_global`, read with empty defaults so the site renders without it. Menus are navigations (`main`, `footer`).

- Describe each template in `content.schema.json`, and each section type in its `section.json`
  (docs: [content schema](https://docs.brease.io/docs/developers/content-schema),
  [sections](https://docs.brease.io/docs/developers/sections)).
- Replace hard-coded text, images and links in the templates with values from `page.content`.
- Mark every element that shows a content value with `data-brease` (`fieldPath`, `navPath`, `sectionAttrs`) so
  editors can click it in the preview. Details: [editor markers](https://docs.brease.io/docs/developers/editor-markers).

## 5. Write the site's current content into brease-seed/

Copy the site's existing text, images and links, in every language it has, into `brease-seed/` with the layout in
[references/seed.md](references/seed.md). Images are `{ "$file": "<path in the repo>", "alt": "…" }`: Brease
uploads them to the site's media library when setup imports the seed. Don't delete the site's own content files or
images: the seed is a copy, and the person decides what to remove later. (Moving a static page's HTML into
`templates/` is fine: its text lives on in `brease-seed/`. Pages whose address changes, like `/about.html` →
`/about`, get a redirect in `brease-seed/redirects.json`.)

## 6. Add BREASE.md

Write `BREASE.md` at the site's root: the stack, where content is read, the content model (pages, templates,
section types), the marker rules and how caching works. It's what Brease's AI reads before every change.
Template: [BREASE.md docs](https://docs.brease.io/docs/developers/brease-md).

## 7. Check your work

Run, in the site's root:

```sh
npx brease-client check
```

and the site's own checks (typecheck, lint). It prints `Ready for Brease.` when everything it can check locally is
in place; fix every `problem:` line before reporting.

Builds read content from Brease, so before the site is connected (no `BREASE_TOKEN`) a full build can't run:
- Next.js: `BREASE_PREVIEW=1` + the build command checks that the code compiles without content.
- Static HTML, single-page apps, Angular, static Astro/SvelteKit: skip the build; Brease builds the site in setup's
  Final checks.
- With a token in `.env.local` (the person connected the site already): run the real build and open a few pages.

## 8. Report to the person

Finish with a short report in plain words:

- what you changed (files, routes, the content you moved into `brease-seed/`);
- what `brease-client check` and the build said;
- anything you left as it was on purpose (forms, embeds, pages you couldn't map) and why;
- next step: commit and push the branch, connect the repository in Brease's setup, and Brease's **Final checks**
  step imports the seed and confirms the setup. If it lists something missing, fix it and press **Check again**.

## Never

- Commit `BREASE_TOKEN`, `.env.local` or any other secret.
- Delete the site's own content, pages or images.
- Push to the main branch, merge or deploy without the person's say.
- Change the design. Same markup, styles and scripts; only where the content comes from changes.

Full manual guide, for anything this skill doesn't cover:
[Integrate a site](https://docs.brease.io/docs/developers/integrate-a-site) (Markdown:
`https://docs.brease.io/llms.mdx/docs/developers/integrate-a-site`).
