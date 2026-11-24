/// <reference types="node" />
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join, posix, relative } from 'node:path'

// `brease-client check`, beyond sections: what Brease's setup (Final checks) looks at in a repository, checked
// locally. Problems block Final checks; warnings and notes don't.
export type SetupReport = { problems: string[]; warnings: string[]; notes: string[] }

const SKIP = new Set([
  'node_modules',
  '.git',
  'dist',
  'build',
  '.next',
  '.astro',
  '.svelte-kit',
  '.output',
  '.vercel'
])

function files(dir: string, root = dir, out: string[] = []) {
  for (const name of readdirSync(dir)) {
    if (SKIP.has(name)) continue
    const path = join(dir, name)
    const stat = statSync(path)
    if (stat.isDirectory()) files(path, root, out)
    else if (stat.size < 512 * 1024) out.push(relative(root, path).split('\\').join('/'))
  }
  return out
}

function json(path: string): { value?: unknown; error?: string } {
  try {
    return { value: JSON.parse(readFileSync(path, 'utf8')) }
  } catch (err) {
    return { error: (err as Error).message }
  }
}

function fileRefs(value: unknown, out: string[]) {
  if (Array.isArray(value)) for (const v of value) fileRefs(v, out)
  else if (value && typeof value === 'object') {
    const file = (value as { $file?: unknown }).$file
    if (typeof file === 'string') out.push(file)
    else for (const v of Object.values(value)) fileRefs(v, out)
  }
}

const LOCALE = /^[a-z]{2,3}(-[A-Za-z0-9]{2,8})*$/

// Images given as plain paths instead of $file: Brease's import finds them the same way (a small copy of its rules:
// image objects with url/src, image-named fields, SEO images), looking in public/, static/, the root, src/assets/,
// assets/ and the seed folder.
const IMAGE_EXT = /\.(avif|gif|ico|jpe?g|png|svg|webp)$/i
const IMAGE_KEY =
  /(image|img|photo|picture|logo|icon|background|cover|thumbnail|thumb|avatar|poster|banner|favicon)$/i

function imagePath(raw: string): string | null {
  const text = raw.trim()
  if (!text || /^(https?:|data:|blob:|mailto:|tel:|#|javascript:)/i.test(text) || text.startsWith('//'))
    return null
  if (/\s/.test(text)) return null
  let path = text.split(/[?#]/)[0] as string
  try {
    path = decodeURI(path)
  } catch {}
  path = path.replace(/^\.\//, '')
  return path && !path.includes('..') && IMAGE_EXT.test(path) ? path : null
}

function plainImages(value: unknown, key: string, out: string[]) {
  if (Array.isArray(value)) for (const v of value) plainImages(v, key, out)
  else if (value && typeof value === 'object') {
    const o = value as Record<string, unknown>
    if (typeof o.$file === 'string') return
    const raw = typeof o.url === 'string' ? o.url : typeof o.src === 'string' ? o.src : null
    if (raw !== null && !('href' in o) && !('label' in o) && !o.assetId) {
      const path = imagePath(raw)
      if (path) out.push(path)
      return
    }
    for (const [k, v] of Object.entries(o)) plainImages(v, k, out)
  } else if (typeof value === 'string' && IMAGE_KEY.test(key)) {
    const path = imagePath(value)
    if (path) out.push(path)
  }
}

function imageFound(root: string, seedDir: string, path: string) {
  const p = path.replace(/^\/+/, '')
  const list = path.startsWith('/')
    ? ['public', 'static', '', 'src/assets', 'assets', seedDir]
    : [seedDir, '', 'public', 'static', 'src/assets', 'src', 'assets']
  return list.some((dir) => existsSync(join(root, dir, p)))
}

function checkSeed(root: string, dir: string, report: SetupReport) {
  const name = relative(root, dir)
  if (!existsSync(join(dir, 'manifest.json'))) report.problems.push(`${name}/manifest.json is missing`)
  const pagesDir = join(dir, 'pages')
  if (!existsSync(pagesDir)) {
    report.problems.push(`${name}/pages/ is missing: the seed has no pages`)
    return
  }
  const refs: string[] = []
  const plain: string[] = []
  const locales = new Set<string>()
  let pages = 0
  for (const pageId of readdirSync(pagesDir)) {
    const pageDir = join(pagesDir, pageId)
    if (!statSync(pageDir).isDirectory()) continue
    pages++
    if (!existsSync(join(pageDir, 'page.json')))
      report.problems.push(`${name}/pages/${pageId}/page.json is missing`)
    for (const file of readdirSync(pageDir)) {
      if (!file.endsWith('.json')) continue
      const parsed = json(join(pageDir, file))
      if (parsed.error) {
        report.problems.push(`${name}/pages/${pageId}/${file} isn't valid JSON: ${parsed.error}`)
        continue
      }
      if (file === 'page.json') continue
      const locale = file.slice(0, -5)
      if (!LOCALE.test(locale)) {
        report.problems.push(`${name}/pages/${pageId}/${file}: "${locale}" isn't a language code`)
        continue
      }
      locales.add(locale)
      const page = parsed.value as { slug?: unknown; content?: unknown }
      if (typeof page?.slug !== 'string')
        report.problems.push(`${name}/pages/${pageId}/${file} has no "slug"`)
      fileRefs(page, refs)
      plainImages(page, '', plain)
    }
  }
  for (const extra of ['site.json', 'redirects.json']) {
    const path = join(dir, extra)
    if (!existsSync(path)) continue
    const parsed = json(path)
    if (parsed.error) report.problems.push(`${name}/${extra} isn't valid JSON: ${parsed.error}`)
    else {
      fileRefs(parsed.value, refs)
      if (extra === 'site.json') plainImages(parsed.value, '', plain)
    }
  }
  const navDir = join(dir, 'navigations')
  if (existsSync(navDir))
    for (const file of readdirSync(navDir).filter((f) => f.endsWith('.json'))) {
      const parsed = json(join(navDir, file))
      if (parsed.error) report.problems.push(`${name}/navigations/${file} isn't valid JSON: ${parsed.error}`)
    }
  const missing = [...new Set(refs)].filter(
    (ref) => !existsSync(join(root, posix.normalize(ref).replace(/^\/+/, '')))
  )
  for (const ref of missing)
    report.problems.push(
      `An image or file in the seed points at ${ref}, which isn't in the site (paths start at the site's root)`
    )
  for (const path of [...new Set(plain)].filter((p) => !imageFound(root, name, p)))
    report.warnings.push(
      `The seed names the image ${path}, which isn't in public/, static/, the site's root, src/assets/, assets/ or ${name}/: Brease will skip it (use { "$file": "<path from the site's root>" })`
    )
  report.notes.push(
    `Content: ${pages} page(s) in ${[...locales].sort().join(', ') || 'no language'}, ${new Set(refs).size} file(s)`
  )
}

export function setupCheck(root: string): SetupReport {
  const report: SetupReport = { problems: [], warnings: [], notes: [] }
  const pkgPath = join(root, 'package.json')
  if (!existsSync(pkgPath))
    report.problems.push('No package.json here: run the check in the site’s root folder')
  else {
    const pkg = json(pkgPath).value as Record<string, Record<string, string> | undefined> | undefined
    const deps = { ...pkg?.dependencies, ...pkg?.devDependencies }
    if (!deps['brease-client'] && !deps['@brease/client'])
      report.problems.push('brease-client isn’t in package.json: install it with the site’s package manager')
  }
  if (!existsSync(join(root, 'BREASE.md')))
    report.problems.push(
      'BREASE.md is missing: Brease reads it before every change (docs: developers/brease-md)'
    )

  const seed = ['brease-seed', '.brease'].map((d) => join(root, d)).find((d) => existsSync(d))
  if (seed) checkSeed(root, seed, report)
  else
    report.notes.push(
      'No brease-seed/ folder: Brease starts with empty content unless it is already in Brease'
    )

  if (!existsSync(join(root, 'content.schema.json')))
    report.notes.push(
      'No content.schema.json: Brease can’t check content before saving it (docs: content-schema)'
    )

  const all = files(root)
  for (const file of all) {
    const base = posix.basename(file)
    if (/^\.env(\..+)?\.local$/.test(base) || base === '.env.example') continue
    let text: string
    try {
      text = readFileSync(join(root, file), 'utf8')
    } catch {
      continue
    }
    if (/BREASE_TOKEN\s*[=:]\s*['"]?[A-Za-z0-9_\-.]{16,}/.test(text))
      report.problems.push(
        `${file} contains a Brease token: keep it in .env.local or the host’s settings only`
      )
  }
  if (!all.some((f) => /data-brease/.test(safeRead(join(root, f)))))
    report.problems.push(
      'No data-brease markers found: editors can’t click content in the preview (docs: editor-markers)'
    )
  return report
}

function safeRead(path: string) {
  if (!/\.(tsx?|jsx?|astro|svelte|vue|html?|mdx?)$/.test(path)) return ''
  try {
    return readFileSync(path, 'utf8')
  } catch {
    return ''
  }
}
