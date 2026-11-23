import { headTags } from './html'
import type { LocaleLink } from './locales'
import type { Navigation, NavigationItem, Page } from './types'

// A static site's own HTML, filled from Brease: the same data-brease markers the editor reads say where each
// value goes, so the page keeps its markup, classes and scripts. Used by `brease-client build` and `serve`.
//
// - data-brease="hero.title" on any element: its text (HTML for rich text) becomes the field's value.
// - On <img>/<source>: src, alt, width and height from an image field ({ url, alt, width, height }).
// - On <a>: href (and target) from a link field ({ label, href }); the label replaces the text when the
//   link has no child elements.
// - On other elements given an image: the image becomes the element's background-image.
// - A list field: the element's first child marked data-brease-item is repeated for each item, its markers
//   written for the first item (`rooms.0.name`) and renumbered for the others.
// - data-brease="nav:main": the data-brease-item child is repeated per menu item; its <a> gets the item's url
//   and label (or the elements marked data-brease-label get the label). The item linking to the page being
//   rendered gets aria-current="page", plus the class named in data-brease-current-class on the list, if any.
// - data-brease="locales": a language switcher; the data-brease-item child is repeated per locale (see
//   localeLinks), its <a> gets the address, hreflang and the language's own name, the current one is marked
//   like the current menu item.
// - "_global:footer.copyright": a field of the site-wide page; written out with that page's id, as the editor
//   expects.
// - <!-- brease:head --> becomes the page's SEO tags; <html lang> becomes the page's locale.
// A field with no value leaves the template's own markup in place.

export type TemplateData = {
  page: Pick<Page, 'pageId' | 'locale' | 'content' | 'resolvedSeo'> & Partial<Pick<Page, 'url'>>
  global?: Pick<Page, 'pageId' | 'content'> | null
  navigations?: Record<string, Navigation | null>
  locales?: LocaleLink[]
}

type Attr = { name: string; value: string | null }
type Element = {
  kind: 'el'
  tag: string
  attrs: Attr[]
  children: Node[]
  selfClosing: boolean
  void: boolean
}
type Node = Element | { kind: 'raw'; text: string }

const VOID = new Set([
  'area',
  'base',
  'br',
  'col',
  'embed',
  'hr',
  'img',
  'input',
  'link',
  'meta',
  'source',
  'track',
  'wbr'
])
const RAW_TEXT = new Set(['script', 'style', 'textarea', 'title'])
const ATTR = /([^\s"'>/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g

function parseAttrs(source: string): Attr[] {
  const attrs: Attr[] = []
  for (const m of source.matchAll(ATTR)) {
    attrs.push({ name: m[1] as string, value: m[2] ?? m[3] ?? m[4] ?? null })
  }
  return attrs
}

// A forgiving tokenizer: comments, doctype and raw-text elements are kept as written; a closing tag closes the
// nearest open element of that name, as browsers do for the cases templates contain.
export function parseHtml(html: string): Node[] {
  const root: Element = { kind: 'el', tag: '#root', attrs: [], children: [], selfClosing: false, void: false }
  const stack: Element[] = [root]
  const top = () => stack[stack.length - 1] as Element
  let i = 0
  const text = (t: string) => {
    if (t) top().children.push({ kind: 'raw', text: t })
  }
  while (i < html.length) {
    const lt = html.indexOf('<', i)
    if (lt === -1) {
      text(html.slice(i))
      break
    }
    text(html.slice(i, lt))
    if (html.startsWith('<!--', lt)) {
      const end = html.indexOf('-->', lt + 4)
      const stop = end === -1 ? html.length : end + 3
      text(html.slice(lt, stop))
      i = stop
      continue
    }
    if (html[lt + 1] === '!' || html[lt + 1] === '?') {
      const end = html.indexOf('>', lt)
      const stop = end === -1 ? html.length : end + 1
      text(html.slice(lt, stop))
      i = stop
      continue
    }
    const close = /^<\/([a-zA-Z][\w:-]*)\s*>/.exec(html.slice(lt))
    if (close) {
      const name = (close[1] as string).toLowerCase()
      const at = stack.map((e) => e.tag).lastIndexOf(name)
      if (at > 0) stack.length = at
      i = lt + close[0].length
      continue
    }
    const open =
      /^<([a-zA-Z][\w:-]*)((?:\s+[^\s"'>/=]+(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s"'=<>`]+))?)*)\s*(\/?)>/.exec(
        html.slice(lt)
      )
    if (!open) {
      text('<')
      i = lt + 1
      continue
    }
    const tag = (open[1] as string).toLowerCase()
    const el: Element = {
      kind: 'el',
      tag,
      attrs: parseAttrs(open[2] ?? ''),
      children: [],
      selfClosing: open[3] === '/',
      void: VOID.has(tag)
    }
    top().children.push(el)
    i = lt + open[0].length
    if (el.void || el.selfClosing) continue
    if (RAW_TEXT.has(tag)) {
      const end = html.toLowerCase().indexOf(`</${tag}`, i)
      const stop = end === -1 ? html.length : end
      if (stop > i) el.children.push({ kind: 'raw', text: html.slice(i, stop) })
      const gt = end === -1 ? html.length : html.indexOf('>', end)
      i = gt === -1 ? html.length : gt + 1
      continue
    }
    stack.push(el)
  }
  return root.children
}

const escapeText = (v: string) => v.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
const escapeAttr = (v: string) => escapeText(v).replace(/"/g, '&quot;')

export function serializeHtml(nodes: Node[]): string {
  return nodes
    .map((n) => {
      if (n.kind === 'raw') return n.text
      const attrs = n.attrs.map((a) =>
        a.value === null ? ` ${a.name}` : ` ${a.name}="${escapeAttr(a.value)}"`
      )
      const open = `<${n.tag}${attrs.join('')}${n.selfClosing ? ' /' : ''}>`
      if (n.void || n.selfClosing) return open
      return `${open}${serializeHtml(n.children)}</${n.tag}>`
    })
    .join('')
}

const attr = (el: Element, name: string) => el.attrs.find((a) => a.name === name)
function setAttr(el: Element, name: string, value: string | null) {
  const found = attr(el, name)
  if (found) found.value = value
  else el.attrs.push({ name, value })
}
const removeAttr = (el: Element, name: string) => {
  el.attrs = el.attrs.filter((a) => a.name !== name)
}
const elements = (nodes: Node[]) => nodes.filter((n): n is Element => n.kind === 'el')

function valueAt(source: unknown, path: string): unknown {
  let current = source
  for (const key of path.split('.')) {
    if (current === null || typeof current !== 'object') return undefined
    current = (current as Record<string, unknown>)[key]
  }
  return current
}

const isImage = (v: unknown): v is { url: string; alt?: string; width?: number; height?: number } =>
  !!v && typeof v === 'object' && typeof (v as { url?: unknown }).url === 'string' && !('href' in v)
const isLink = (v: unknown): v is { label?: string; href: string; target?: string } =>
  !!v && typeof v === 'object' && typeof (v as { href?: unknown }).href === 'string'
const looksLikeHtml = (v: string) => /<[a-z][\s\S]*>/i.test(v)

function setText(el: Element, value: string, html: boolean) {
  el.children = [{ kind: 'raw', text: html ? value : escapeText(value) }]
}

function renumber(nodes: Node[], listPath: string, index: number) {
  const from = `${listPath}.0.`
  const to = `${listPath}.${index}.`
  for (const el of elements(nodes)) {
    const marker = attr(el, 'data-brease')
    if (marker?.value?.includes(from)) marker.value = marker.value.replace(from, to)
    renumber(el.children, listPath, index)
  }
}

const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value))

function itemTemplate(el: Element) {
  const children = elements(el.children)
  const template = children.find((c) => attr(c, 'data-brease-item'))
  return template ?? null
}

const pathOnly = (url: string) => {
  try {
    return new URL(url, 'http://localhost').pathname.replace(/(.)\/+$/, '$1')
  } catch {
    return url
  }
}

function markCurrent(item: Element, link: Element | undefined, currentClass: string | undefined) {
  if (link) setAttr(link, 'aria-current', 'page')
  if (currentClass) {
    const classes = (attr(item, 'class')?.value ?? '').split(/\s+/).filter(Boolean)
    if (!classes.includes(currentClass)) setAttr(item, 'class', [...classes, currentClass].join(' '))
  }
}

function linkParts(copy: Element) {
  const labels: Element[] = []
  const links: Element[] = []
  const walk = (el: Element) => {
    if (attr(el, 'data-brease-label')) labels.push(el)
    if (el.tag === 'a') links.push(el)
    for (const c of elements(el.children)) walk(c)
  }
  walk(copy)
  return { labels, link: copy.tag === 'a' ? copy : links[0] }
}

function renderLocaleItem(template: Element, item: LocaleLink, currentClass: string | undefined) {
  const copy = clone(template)
  const { labels, link } = linkParts(copy)
  if (link) {
    setAttr(link, 'href', item.href)
    setAttr(link, 'hreflang', item.locale)
    setAttr(link, 'lang', item.locale)
    if (!labels.length && !elements(link.children).length) setText(link, item.label, false)
  }
  for (const label of labels) setText(label, item.label, false)
  if (item.current) markCurrent(copy, link, currentClass)
  return copy
}

function renderNavItem(
  template: Element,
  item: NavigationItem,
  currentPath: string | null,
  currentClass: string | undefined
) {
  const copy = clone(template)
  const { labels, link } = linkParts(copy)
  if (link) {
    setAttr(link, 'href', item.url)
    if (item.target === '_blank') setAttr(link, 'target', '_blank')
    if (!labels.length && !elements(link.children).length) setText(link, item.label, false)
  }
  for (const label of labels) setText(label, item.label, false)
  if (currentPath && item.url && pathOnly(item.url) === currentPath) markCurrent(copy, link, currentClass)
  return copy
}

export function renderTemplate(template: string, data: TemplateData): string {
  const nodes = parseHtml(template)
  const head = headTags(data.page.resolvedSeo)
  const currentPath = data.page.url ? pathOnly(data.page.url) : null

  const resolve = (ref: string): { value: unknown; marker: string } => {
    const at = ref.indexOf(':')
    if (at === -1) return { value: valueAt(data.page.content, ref), marker: ref }
    const owner = ref.slice(0, at)
    const path = ref.slice(at + 1)
    if (owner === '_global') {
      const global = data.global
      return {
        value: global ? valueAt(global.content, path) : undefined,
        marker: global ? `${global.pageId}:${path}` : ref
      }
    }
    return { value: undefined, marker: ref }
  }

  const fill = (el: Element) => {
    const marker = attr(el, 'data-brease')
    const ref = marker?.value
    const currentClass = attr(el, 'data-brease-current-class')?.value ?? undefined
    if (marker && ref === 'locales') {
      const template = itemTemplate(el)
      if (data.locales && template) {
        const rendered = data.locales.map((item) => renderLocaleItem(template, item, currentClass))
        el.children = el.children.flatMap((c) =>
          c === template ? rendered : c.kind === 'el' && attr(c, 'data-brease-item') ? [] : [c]
        )
      }
      return
    }
    if (marker && ref?.startsWith('nav:')) {
      const items = data.navigations?.[ref.slice(4)]?.items
      const template = itemTemplate(el)
      if (items && template) {
        const rendered = items.map((item) => renderNavItem(template, item, currentPath, currentClass))
        el.children = el.children.flatMap((c) =>
          c === template ? rendered : c.kind === 'el' && attr(c, 'data-brease-item') ? [] : [c]
        )
      }
      return
    }
    if (marker && ref) {
      const { value, marker: written } = resolve(ref)
      marker.value = written
      if (Array.isArray(value)) {
        const template = itemTemplate(el)
        if (template) {
          const listPath = written
          const rendered = value.map((_, index) => {
            const copy = clone(template)
            if (index > 0) renumber([copy], listPath, index)
            return copy
          })
          el.children = el.children.flatMap((c) =>
            c === template ? rendered : c.kind === 'el' && attr(c, 'data-brease-item') ? [] : [c]
          )
        }
      } else if (isImage(value)) {
        if (el.tag === 'img' || el.tag === 'source') {
          setAttr(el, el.tag === 'source' ? 'srcset' : 'src', value.url)
          if (el.tag === 'img') {
            removeAttr(el, 'srcset')
            if (value.alt !== undefined) setAttr(el, 'alt', value.alt)
            if (value.width) setAttr(el, 'width', String(value.width))
            if (value.height) setAttr(el, 'height', String(value.height))
          }
        } else {
          const style = (attr(el, 'style')?.value ?? '').replace(/background-image\s*:[^;]*;?/i, '').trim()
          setAttr(
            el,
            'style',
            `${style ? `${style.replace(/;?$/, ';')} ` : ''}background-image: url('${value.url}')`
          )
        }
      } else if (isLink(value)) {
        if (el.tag === 'a') {
          setAttr(el, 'href', value.href)
          if (value.target === '_blank') setAttr(el, 'target', '_blank')
        }
        if (value.label !== undefined && !elements(el.children).length) setText(el, value.label, false)
      } else if (typeof value === 'string' || typeof value === 'number') {
        const text = String(value)
        setText(el, text, attr(el, 'data-brease-html') !== undefined || looksLikeHtml(text))
        return
      }
    }
    for (const child of elements(el.children)) fill(child)
  }

  const walk = (list: Node[]) => {
    for (let i = 0; i < list.length; i++) {
      const n = list[i] as Node
      if (n.kind === 'raw') {
        if (n.text.includes('<!-- brease:head -->')) n.text = n.text.replace('<!-- brease:head -->', head)
        continue
      }
      if (n.tag === 'html') setAttr(n, 'lang', data.page.locale)
      if (n.tag === 'script' || n.tag === 'style') continue
      if (attr(n, 'data-brease')) fill(n)
      else walk(n.children)
    }
  }
  walk(nodes)
  return serializeHtml(nodes)
}
