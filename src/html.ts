import type { ResolvedSeo } from './types'

export type HeadOptions = {
  xDefault?: string
  // customHead and customCode are raw HTML from the site's owners; pass false to leave them out.
  includeCustom?: boolean
}

export type HeadTag = {
  tag: 'title' | 'meta' | 'link' | 'script'
  attrs: Record<string, string>
  content?: string
}

export function headTagList(seo: ResolvedSeo, opts: HeadOptions = {}): HeadTag[] {
  const tags: HeadTag[] = [{ tag: 'title', attrs: {}, content: seo.title }]
  const meta = (key: 'name' | 'property', name: string, value: string | undefined) => {
    if (value) tags.push({ tag: 'meta', attrs: { [key]: name, content: value } })
  }
  meta('name', 'description', seo.description)
  if (seo.canonical) tags.push({ tag: 'link', attrs: { rel: 'canonical', href: seo.canonical } })
  meta(
    'name',
    'robots',
    `${seo.robots.index ? 'index' : 'noindex'}, ${seo.robots.follow ? 'follow' : 'nofollow'}`
  )
  for (const [lang, href] of Object.entries(seo.alternates)) {
    tags.push({ tag: 'link', attrs: { rel: 'alternate', hreflang: lang, href } })
  }
  if (opts.xDefault) {
    tags.push({ tag: 'link', attrs: { rel: 'alternate', hreflang: 'x-default', href: opts.xDefault } })
  }
  const og = seo.openGraph
  meta('property', 'og:type', og.type)
  meta('property', 'og:title', og.title)
  meta('property', 'og:description', og.description)
  meta('property', 'og:image', og.image)
  meta('property', 'og:url', og.url)
  meta('property', 'og:site_name', og.siteName)
  const tw = seo.twitter
  meta('name', 'twitter:card', tw.card)
  meta('name', 'twitter:site', tw.site)
  meta('name', 'twitter:creator', tw.creator)
  meta('name', 'twitter:title', tw.title)
  meta('name', 'twitter:description', tw.description)
  meta('name', 'twitter:image', tw.image)
  if (seo.favicon) tags.push({ tag: 'link', attrs: { rel: 'icon', href: seo.favicon } })
  for (const data of seo.structuredData) {
    tags.push({
      tag: 'script',
      attrs: { type: 'application/ld+json' },
      content: JSON.stringify(data).replace(/</g, '\\u003c')
    })
  }
  return tags
}

const escapeHtml = (value: string) =>
  value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

export function renderTag(t: HeadTag): string {
  const attrs = Object.entries(t.attrs)
    .map(([k, v]) => ` ${k}="${escapeHtml(v)}"`)
    .join('')
  if (t.tag === 'meta' || t.tag === 'link') return `<${t.tag}${attrs}>`
  const content = t.tag === 'script' ? (t.content ?? '') : escapeHtml(t.content ?? '')
  return `<${t.tag}${attrs}>${content}</${t.tag}>`
}

export function headTags(seo: ResolvedSeo, opts: HeadOptions = {}): string {
  const parts = headTagList(seo, opts).map(renderTag)
  if (opts.includeCustom !== false) {
    if (seo.customHead) parts.push(seo.customHead)
    if (seo.customCode) parts.push(seo.customCode)
  }
  return parts.join('\n')
}
