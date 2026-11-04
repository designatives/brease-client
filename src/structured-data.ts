import type { ResolvedSeo } from './types'

// The page's structured data (site defaults first, then the page's own), each item ready to render as a
// <script type="application/ld+json">. `json` is escaped so "</script>" inside a value can't close the tag.
export type JsonLd = { data: Record<string, unknown>; json: string }

export const jsonLdText = (data: unknown) => JSON.stringify(data).replace(/</g, '\\u003c')

export function jsonLd(seo: Pick<ResolvedSeo, 'structuredData'>): JsonLd[] {
  return (seo.structuredData ?? []).map((data) => ({ data, json: jsonLdText(data) }))
}

// The same as HTML, for server-rendered pages; an empty string when there is none.
export function jsonLdHtml(seo: Pick<ResolvedSeo, 'structuredData'>): string {
  return jsonLd(seo)
    .map((d) => `<script type="application/ld+json">${d.json}</script>`)
    .join('\n')
}
