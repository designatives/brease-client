// Sections convention: a page's sections are one list, content.sections, rendered in order inside an element
// with data-brease-sections="sections". Every section type is a folder (src/brease/sections/<type>/) with a
// section.json and its component; the folder's map file renders each type, and nothing for unknown ones.

export type BreaseSection<T = Record<string, unknown>> = { id: string; type: string } & T

// The attributes for the element that holds the list.
export const sectionsAttrs = { 'data-brease-sections': 'sections' } as const

// The attributes for a section's root element.
export function sectionAttrs(section: { id: string; type: string }) {
  return { 'data-brease-section': section.id, 'data-brease-block': section.type }
}

export const SECTION_FOLDERS = ['src/brease/sections', 'brease/sections']

const TYPE_NAME = /^[a-z0-9]+(-[a-z0-9]+)*$/

type PageLocales = Record<string, Record<string, { content?: unknown }>>

// Warnings for a site's sections: `files` maps paths under the sections folder (e.g.
// "src/brease/sections/hero/section.json") to their text; `pages` is pageId -> locale -> page file, when known.
export function checkSections(files: Record<string, string>, pages: PageLocales = {}): string[] {
  const warnings: string[] = []
  const folder = SECTION_FOLDERS.find((f) => Object.keys(files).some((p) => p.startsWith(`${f}/`)))
  if (!folder) return warnings
  const inFolder = Object.entries(files).map(([p, text]) => [p.slice(folder.length + 1), text] as const)
  const types = [
    ...new Set(
      inFolder
        .map(([p]) => p.split('/'))
        .filter((s) => s.length > 1)
        .map((s) => s[0] as string)
    )
  ]
  const map = inFolder.find(([p]) => /^index\.[cm]?[jt]sx?$/.test(p))
  if (!map)
    warnings.push(`${folder} has no map file (index.tsx, index.ts or index.js) rendering the section types`)
  const marked = inFolder.some(
    ([, text]) => text.includes('data-brease-section') || text.includes('sectionAttrs(')
  )
  if (!marked)
    warnings.push(
      `No component in ${folder} renders data-brease-section (or sectionAttrs), so editors can't add sections`
    )
  for (const type of types) {
    if (!TYPE_NAME.test(type)) {
      warnings.push(`${folder}/${type}: use lowercase letters, numbers and - in section folder names`)
      continue
    }
    const json = files[`${folder}/${type}/section.json`]
    if (json === undefined) {
      warnings.push(`${folder}/${type} has no section.json`)
      continue
    }
    try {
      const meta = JSON.parse(json) as { name?: unknown; fields?: unknown }
      if (typeof meta.name !== 'string' || !meta.name.trim())
        warnings.push(`${folder}/${type}/section.json has no name`)
      if (meta.fields !== undefined && (typeof meta.fields !== 'object' || meta.fields === null))
        warnings.push(`${folder}/${type}/section.json: fields must be a JSON Schema object`)
    } catch {
      warnings.push(`${folder}/${type}/section.json is not valid JSON`)
    }
    if (map && !map[1].includes(type)) warnings.push(`${type} is in ${folder} but not in its map file`)
  }
  const known = new Set(types)
  for (const [pageId, locales] of Object.entries(pages)) {
    let reference: string | null = null
    for (const [locale, file] of Object.entries(locales)) {
      const list = (file.content as { sections?: unknown } | undefined)?.sections
      if (list === undefined) continue
      if (!Array.isArray(list)) {
        warnings.push(`${pageId} (${locale}): sections is not a list`)
        continue
      }
      const ids = new Set<string>()
      for (const item of list as { id?: unknown; type?: unknown }[]) {
        if (typeof item?.id !== 'string' || typeof item.type !== 'string') {
          warnings.push(`${pageId} (${locale}): a section has no id or type`)
          continue
        }
        if (ids.has(item.id)) warnings.push(`${pageId} (${locale}): section ${item.id} appears twice`)
        ids.add(item.id)
        if (!known.has(item.type))
          warnings.push(`${pageId} (${locale}): section type "${item.type}" has no folder`)
      }
      const shape = (list as { id?: unknown; type?: unknown }[]).map((s) => `${s?.id}:${s?.type}`).join(',')
      if (reference === null) reference = shape
      else if (shape !== reference)
        warnings.push(`${pageId}: the sections in ${locale} differ from the other locales`)
    }
  }
  return warnings
}
