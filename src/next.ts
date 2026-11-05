import { env } from './env'
import { type Brease, createBrease } from './index'
import { verifyRevalidate } from './signature'
import type { ResolvedSeo } from './types'

export type BreaseMetadata = {
  title: { absolute: string }
  description?: string
  alternates: { canonical?: string; languages: Record<string, string> }
  robots: { index: boolean; follow: boolean }
  openGraph: {
    type?: string
    title?: string
    description?: string
    url?: string
    siteName?: string
    images?: { url: string }[]
  }
  twitter: {
    card?: 'summary' | 'summary_large_image'
    site?: string
    creator?: string
    title?: string
    description?: string
    images?: string[]
  }
  icons?: { icon: string }
  other?: Record<string, string>
}

const compact = <T extends Record<string, unknown>>(obj: T): T =>
  Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== undefined)) as T

// Maps resolvedSeo to a value assignable to Next's `Metadata`.
export function toMetadata(seo: ResolvedSeo, opts: { xDefault?: string } = {}): BreaseMetadata {
  const languages = { ...seo.alternates }
  if (opts.xDefault) languages['x-default'] = opts.xDefault
  return compact({
    title: { absolute: seo.title },
    description: seo.description,
    alternates: compact({ canonical: seo.canonical, languages }),
    robots: { index: seo.robots.index, follow: seo.robots.follow },
    openGraph: compact({
      type: seo.openGraph.type,
      title: seo.openGraph.title,
      description: seo.openGraph.description,
      url: seo.openGraph.url,
      siteName: seo.openGraph.siteName,
      images: seo.openGraph.image ? [{ url: seo.openGraph.image }] : undefined
    }),
    twitter: compact({
      card: seo.twitter.card,
      site: seo.twitter.site,
      creator: seo.twitter.creator,
      title: seo.twitter.title,
      description: seo.twitter.description,
      images: seo.twitter.image ? [seo.twitter.image] : undefined
    }),
    icons: seo.favicon ? { icon: seo.favicon } : undefined
  })
}

// fetch for createBrease({ fetch }) that tags every request so revalidateTag('brease') purges it. In the
// Brease editor's preview (BREASE_PREVIEW=1) nothing is cached, so every edit shows on the next render.
export function breaseFetch(tags: string[] = [], revalidate?: number | false): typeof fetch {
  return (input, init) =>
    env('BREASE_PREVIEW')
      ? fetch(input, { ...init, cache: 'no-store' })
      : fetch(input, {
          ...init,
          next: { tags: ['brease', ...tags], ...(revalidate !== undefined ? { revalidate } : {}) }
        } as RequestInit)
}

// Route handler for app/api/brease/revalidate/route.ts, the path Brease calls (REVALIDATE_PATH):
// `export const POST = revalidateHandler()`. Refreshes at once (expire: 0): a published release is live.
export function revalidateHandler(secret?: string) {
  return async (req: Request): Promise<Response> => {
    const key = secret ?? env('BREASE_REVALIDATE_SECRET')
    if (!key)
      return json(500, { error: { code: 'internal', message: 'BREASE_REVALIDATE_SECRET is not set' } })
    const target = await verifyRevalidate(req, key)
    if (!target.ok)
      return target.reason === 'body'
        ? json(400, { error: { code: 'validation', message: 'Body must be JSON' } })
        : json(401, { error: { code: 'unauthorized', message: 'Invalid or expired signature' } })
    const cache = (await import('next/cache')) as {
      revalidatePath: (path: string) => void
      revalidateTag: (tag: string, profile?: string | { expire?: number }) => void
    }
    for (const path of target.paths) cache.revalidatePath(path)
    for (const tag of target.tags) cache.revalidateTag(tag, { expire: 0 })
    return json(200, { revalidated: true, paths: target.paths, tags: target.tags })
  }
}

function json(status: number, data: unknown) {
  return new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json' } })
}

// next.config's redirects(), from the redirects managed in Brease. Build goes on without them when the
// content API can't be reached.
export function breaseRedirects(client: Pick<Brease, 'getRedirects'> = createBrease()) {
  return async () => {
    try {
      const redirects = await client.getRedirects()
      return redirects.map((r) => ({ source: r.source, destination: r.destination, statusCode: r.status }))
    } catch (err) {
      console.warn(`Brease redirects unavailable: ${(err as Error).message}`)
      return []
    }
  }
}

// Kept here for older imports; they live in the root export now.
export { hmacHex, verifySignature } from './signature'
