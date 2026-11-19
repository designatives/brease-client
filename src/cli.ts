#!/usr/bin/env node
/// <reference types="node" />
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { createBrease } from './index'
import { checkSections, SECTION_FOLDERS } from './sections'
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
  brease-client check                  the sections convention
  brease-client build [--out dist]     render every page from templates/ into dist/ (sites without a framework)
  brease-client serve                  the same pages, rendered per request on $PORT (the editor's preview)
  brease-client output <dir>           write Brease's redirects for the host next to built files in <dir>
  brease-client content <file.json> [--nav main,footer] [--watch]
                                       the content a browser-only app imports at build time`

const [command, ...args] = process.argv.slice(2)
const flag = (name: string) => {
  const at = args.indexOf(`--${name}`)
  return at === -1 ? undefined : (args[at + 1] ?? '')
}

function check() {
  const cwd = process.cwd()
  const folder = SECTION_FOLDERS.find((f) => existsSync(join(cwd, f)))
  if (!folder) {
    console.log('No sections folder (src/brease/sections or brease/sections): nothing to check.')
    process.exit(0)
  }
  const files = Object.fromEntries(
    walk(join(cwd, folder)).map((p) => [relative(cwd, p).split('\\').join('/'), readFileSync(p, 'utf8')])
  )
  const content = ['brease-seed', '.brease'].map((d) => join(cwd, d)).find((d) => existsSync(d))
  const warnings = checkSections(files, content ? pagesIn(content) : {})
  for (const w of warnings) console.log(`warning: ${w}`)
  console.log(warnings.length ? `${warnings.length} warning(s)` : 'Sections look right.')
  process.exit(warnings.length ? 1 : 0)
}

async function main() {
  if (command === 'check') return check()
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
    await writeHostOutput(await createBrease().getRedirects(), join(process.cwd(), args[0]), detectHost())
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
