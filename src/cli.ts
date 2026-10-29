#!/usr/bin/env node
/// <reference types="node" />
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { checkSections, SECTION_FOLDERS } from './sections'

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

const [command] = process.argv.slice(2)
if (command !== 'check') {
  console.log('Usage: brease-client check')
  process.exit(command ? 1 : 0)
}
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
