#!/usr/bin/env node
/// <reference types="node" />
import { cpSync, existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createBrease } from './index'
import { checkSections, SECTION_FOLDERS } from './sections'
import { setupCheck } from './setup-check'
import { build, detectHost, exportContent, serve, writeHostOutput, writeJson } from './static-build'

// `brease-client check`: the sections convention in this repository (and in brease-seed/ or .brease/ content).
function walk(dir: string, out: string[] = []) {
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules') continue
    const path = join(dir, name)
    if (statSync(path).isDirectory()) walk(path, out)
    else out.push(path)
  }
  return out
}

function pagesIn(root: string) {
  const pages: Record<string, Record<string, { content?: unknown }>> = {}
  const dir = join(root, 'pages')
  if (!existsSync(dir)) return pages
  for (const pageId of readdirSync(dir)) {
    for (const file of readdirSync(join(dir, pageId))) {
      if (!file.endsWith('.json') || file === 'page.json') continue
      const locales = pages[pageId] ?? {}
      pages[pageId] = locales
      try {
        locales[file.slice(0, -5)] = JSON.parse(readFileSync(join(dir, pageId, file), 'utf8'))
      } catch {}
    }
  }
  return pages
}

const USAGE = `Usage:
  brease-client check                  what Brease's setup checks: brease-client, BREASE.md, brease-seed/,
                                       markers, no committed token, and the sections convention
  brease-client skill [--dir <path>]   install the "breasify" agent skill (default .claude/skills/breasify)
  brease-client build [--out dist]     render every page from templates/ into dist/ (sites without a framework)
  brease-client serve                  the same pages, rendered per request on $PORT (the editor's preview)
  brease-client output <dir> [--spa]   write Brease's redirects for the host next to built files in <dir>
                                       (--spa: unknown paths serve index.html, for browser-only apps)
  brease-client content <file.json> [--nav main,footer] [--watch]
                                       the content a browser-only app imports at build time
  brease-client offline-media <dir>    copy brease-seed/media/ into <dir> (e.g. public) for offline mode
                                       (BREASE_OFFLINE=1 reads the content from brease-seed/)`

const [command, ...args] = process.argv.slice(2)
const flag = (name: string) => {
  const at = args.indexOf(`--${name}`)
  return at === -1 ? undefined : (args[at + 1] ?? '')
}

function check() {
  const cwd = process.cwd()
  const report = setupCheck(cwd)
  const folder = SECTION_FOLDERS.find((f) => existsSync(join(cwd, f)))
  let warnings: string[] = []
  if (folder) {
    const files = Object.fromEntries(
      walk(join(cwd, folder)).map((p) => [relative(cwd, p).split('\\').join('/'), readFileSync(p, 'utf8')])
    )
    const content = ['brease-seed', '.brease'].map((d) => join(cwd, d)).find((d) => existsSync(d))
    warnings = checkSections(files, content ? pagesIn(content) : {})
  }
  for (const n of report.notes) console.log(`note: ${n}`)
  for (const w of [...report.warnings, ...warnings]) console.log(`warning: ${w}`)
  for (const p of report.problems) console.log(`problem: ${p}`)
  if (!report.problems.length && !warnings.length)
    console.log(
      report.warnings.length
        ? `Ready for Brease, with ${report.warnings.length} image warning(s): those images won't be imported.`
        : 'Ready for Brease.'
    )
  else
    console.log(
      [
        report.problems.length ? `${report.problems.length} problem(s)` : '',
        warnings.length ? `${warnings.length} sections warning(s)` : ''
      ]
        .filter(Boolean)
        .join(', ')
    )
  process.exit(report.problems.length || warnings.length ? 1 : 0)
}

// The package's own folder: dist/ sits next to skills/.
const packageDir = () => {
  try {
    return join(dirname(fileURLToPath(import.meta.url)), '..')
  } catch {
    return join(__dirname, '..')
  }
}

function skill() {
  const source = join(packageDir(), 'skills', 'breasify')
  const target = join(process.cwd(), flag('dir') || join('.claude', 'skills', 'breasify'))
  cpSync(source, target, { recursive: true })
  console.log(
    `Installed the breasify skill in ${relative(process.cwd(), target)}. Ask your agent: "breasify this site".`
  )
}

// Offline mode serves images as /brease-seed/media/…: the files go into the site's public folder.
function offlineMedia(dir: string) {
  const source = join(process.cwd(), flag('seed') || 'brease-seed', 'media')
  if (!existsSync(source)) {
    console.log('No brease-seed/media folder: nothing to copy.')
    return
  }
  const target = join(process.cwd(), dir, 'brease-seed', 'media')
  cpSync(source, target, { recursive: true })
  console.log(`Copied the exported media to ${relative(process.cwd(), target)}.`)
}

async function main() {
  if (command === 'check') return check()
  if (command === 'offline-media' && args[0]) return offlineMedia(args[0])
  if (command === 'skill') return skill()
  if (command === 'build') {
    const { pages, out } = await build(createBrease(), { out: flag('out') })
    console.log(`Rendered ${pages.length} page(s) into ${relative(process.cwd(), out) || '.'}`)
    return
  }
  if (command === 'serve') {
    serve(createBrease())
    console.log(`Serving on port ${process.env.PORT ?? 3000}`)
    return
  }
  if (command === 'output' && args[0]) {
    await writeHostOutput(await createBrease().getRedirects(), join(process.cwd(), args[0]), detectHost(), {
      spa: args.includes('--spa')
    })
    return
  }
  if (command === 'content' && args[0]) {
    const file = join(process.cwd(), args[0])
    const keys = (flag('nav') ?? '').split(',').filter(Boolean)
    const brease = createBrease()
    let last = ''
    const write = async () => {
      const json = JSON.stringify(await exportContent(brease, keys))
      if (json === last) return
      last = json
      writeJson(file, JSON.parse(json))
    }
    await write()
    // In the editor's preview the app's dev server picks the file up again after each edit.
    if (args.includes('--watch')) setInterval(() => void write().catch((e) => console.warn(e.message)), 2000)
    return
  }
  console.log(USAGE)
  process.exit(command ? 1 : 0)
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err)
  process.exit(1)
})
