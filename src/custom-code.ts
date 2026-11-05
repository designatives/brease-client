import type { ResolvedSeo } from './types'

// Custom code from Brease (site-wide head code and the page's own code) as tags a framework can render as
// real elements, so scripts run: React and Next render each with <script {...attrs} dangerouslySetInnerHTML>
// (inline) or <script {...attrs} /> (src). Only script, style, meta, link and noscript tags are kept.
export type CustomTag = {
  tag: 'script' | 'style' | 'meta' | 'link' | 'noscript'
  attrs: Record<string, string>
  content?: string
}

const PAIRED = ['script', 'style', 'noscript'] as const
const VOID = ['meta', 'link'] as const

export function customTags(seo: Pick<ResolvedSeo, 'customHead' | 'customCode'>): CustomTag[] {
  return [seo.customHead, seo.customCode].flatMap((html) => (html ? parseTags(html) : []))
}

function parseTags(html: string): CustomTag[] {
  const out: CustomTag[] = []
  const re = /<(script|style|noscript)\b([^>]*)>([\s\S]*?)<\/\1\s*>|<(meta|link)\b([^>]*?)\/?>/gi
  for (const m of html.matchAll(re)) {
    if (m[1]) {
      const tag = m[1].toLowerCase() as (typeof PAIRED)[number]
      out.push({ tag, attrs: attrsOf(m[2] ?? ''), ...(m[3]?.trim() ? { content: m[3] } : {}) })
    } else if (m[4])
      out.push({ tag: m[4].toLowerCase() as (typeof VOID)[number], attrs: attrsOf(m[5] ?? '') })
  }
  return out
}

function attrsOf(source: string): Record<string, string> {
  const attrs: Record<string, string> = {}
  for (const m of source.matchAll(/([^\s"'=<>/]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+)))?/g))
    attrs[(m[1] as string).toLowerCase()] = m[2] ?? m[3] ?? m[4] ?? ''
  return attrs
}
