import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { setupCheck } from './setup-check'

function site(files: Record<string, string>) {
  const root = mkdtempSync(join(tmpdir(), 'brease-check-'))
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(dirname(join(root, path)), { recursive: true })
    writeFileSync(join(root, path), text)
  }
  return root
}

const READY = {
  'package.json': JSON.stringify({ dependencies: { 'brease-client': '^0.15.0' } }),
  'BREASE.md': '# BREASE.md',
  'content.schema.json': '{}',
  'src/page.tsx': '<h1 data-brease="title">{t}</h1>',
  'public/hero.jpg': 'x',
  'brease-seed/manifest.json': '{ "schemaVersion": 1 }',
  'brease-seed/pages/pg_home/page.json': '{ "name": "Home", "parentId": null, "order": 0 }',
  'brease-seed/pages/pg_home/en.json': JSON.stringify({
    slug: '',
    content: { hero: { $file: 'public/hero.jpg', alt: 'A hut' } }
  })
}

describe('setupCheck', () => {
  it('passes a site set up the way Brease checks it', () => {
    const report = setupCheck(site(READY))
    expect(report.problems).toEqual([])
    expect(report.notes).toContain('Content: 1 page(s) in en, 1 file(s)')
  })

  it('names what is missing', () => {
    const report = setupCheck(site({ 'package.json': '{}', 'src/a.tsx': '<p/>' }))
    expect(report.problems.join('\n')).toMatch(/brease-client isn’t in package.json/)
    expect(report.problems.join('\n')).toMatch(/BREASE.md is missing/)
    expect(report.problems.join('\n')).toMatch(/No data-brease markers/)
  })

  it('reports seed files that point at nothing, bad JSON and bad language codes', () => {
    const report = setupCheck(
      site({
        ...READY,
        'brease-seed/pages/pg_home/en.json': JSON.stringify({
          slug: '',
          content: { img: { $file: 'img/gone.jpg' } }
        }),
        'brease-seed/pages/pg_home/English.json': '{}',
        'brease-seed/site.json': '{ nope'
      })
    )
    const text = report.problems.join('\n')
    expect(text).toMatch(/points at img\/gone.jpg/)
    expect(text).toMatch(/"English" isn't a language code/)
    expect(text).toMatch(/site.json isn't valid JSON/)
  })

  it('flags a committed token but not one in .env.local', () => {
    const token = 'brt_0123456789abcdefghij'
    const ok = setupCheck(site({ ...READY, '.env.local': `BREASE_TOKEN=${token}` }))
    expect(ok.problems).toEqual([])
    const bad = setupCheck(site({ ...READY, '.env': `BREASE_TOKEN=${token}` }))
    expect(bad.problems.join('\n')).toMatch(/\.env contains a Brease token/)
  })
})
