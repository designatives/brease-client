import { env } from './env'
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

// fetch for createBrease({ fetch }) that tags every request so revalidateTag('brease') purges it.
export function breaseFetch(tags: string[] = [], revalidate?: number | false): typeof fetch {
  return (input, init) =>
    fetch(input, {
      ...init,
      next: { tags: ['brease', ...tags], ...(revalidate !== undefined ? { revalidate } : {}) }
    } as RequestInit)
}

const MAX_SKEW_MS = 5 * 60_000

type RevalidateBody = {
  urls?: string[]
  paths?: string[]
  tags?: string[]
  releaseId?: string
  siteId?: string
}

// Route handler for app/api/revalidate/route.ts: `export const POST = revalidateHandler()`.
export function revalidateHandler(secret?: string) {
  return async (req: Request): Promise<Response> => {
    const key = secret ?? env('BREASE_REVALIDATE_SECRET')
    if (!key)
      return json(500, { error: { code: 'internal', message: 'BREASE_REVALIDATE_SECRET is not set' } })
    const raw = await req.text()
    const ok = await verifySignature(
      raw,
      req.headers.get('x-brease-timestamp'),
      req.headers.get('x-brease-signature'),
      key
    )
    if (!ok) return json(401, { error: { code: 'unauthorized', message: 'Invalid or expired signature' } })

    let body: RevalidateBody
    try {
      body = JSON.parse(raw || '{}') as RevalidateBody
    } catch {
      return json(400, { error: { code: 'validation', message: 'Body must be JSON' } })
    }
    const paths = new Set<string>(body.paths ?? [])
    for (const url of body.urls ?? []) {
      try {
        paths.add(new URL(url, 'http://localhost').pathname)
      } catch {}
    }
    const tags = new Set<string>(['brease', ...(body.tags ?? [])])

    const cache = (await import('next/cache')) as {
      revalidatePath: (path: string) => void
      revalidateTag: (tag: string, profile?: string) => void
    }
    for (const path of paths) cache.revalidatePath(path)
    for (const tag of tags) cache.revalidateTag(tag, 'max')
    return json(200, { revalidated: true, paths: [...paths], tags: [...tags] })
  }
}

export async function verifySignature(
  body: string,
  timestamp: string | null,
  signature: string | null,
  secret: string,
  now = Date.now()
): Promise<boolean> {
  if (!timestamp || !signature) return false
  if (!Number.isFinite(Number(timestamp)) || Math.abs(now - Number(timestamp)) > MAX_SKEW_MS) return false
  const expected = await hmacHex(secret, `${timestamp}.${body}`)
  if (expected.length !== signature.length) return false
  let diff = 0
  for (let i = 0; i < expected.length; i++) diff |= expected.charCodeAt(i) ^ signature.charCodeAt(i)
  return diff === 0
}

export async function hmacHex(secret: string, message: string): Promise<string> {
  const enc = new TextEncoder()
  const key = await crypto.subtle.importKey(
    'raw',
    enc.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  )
  const sig = new Uint8Array(await crypto.subtle.sign('HMAC', key, enc.encode(message)))
  return Array.from(sig, (b) => b.toString(16).padStart(2, '0')).join('')
}

function json(status: number, data: unknown) {
  return new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json' } })
}
