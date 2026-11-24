import { BreaseError } from './errors'

// Last good page for sites rendered on request in a Cloudflare Worker. A Worker's own responses don't go
// through Cloudflare's CDN cache, so pageCacheControl() alone can't keep such a site up while Brease is down:
// this keeps a copy of every good HTML page in the Worker's Cache API and serves it when a render fails
// because Brease can't be reached. Works anywhere `caches.default` (or an opened cache) exists.

export type LastGoodOptions = {
  /** Background work after the response (Cloudflare's ctx.waitUntil); without it the copy is stored first. */
  waitUntil?: (promise: Promise<unknown>) => void
  /** The cache to use; defaults to Cloudflare's `caches.default`. */
  cache?: Cache
  /** How long a copy may be served, in seconds. Default one day. */
  maxAgeSeconds?: number
  /** The editor's preview or a draft branch: never stored or served. Defaults to pageCacheControl()'s rule. */
  preview?: boolean
  /** Also serve the copy when the render answers 5xx (frameworks often turn thrown errors into a 500). */
  onServerError?: boolean
}

const DAY = 86_400
// Query parameters that only track a visit; they don't change the page.
const TRACKING = /^(utm_[a-z]+|fbclid|gclid|gbraid|wbraid|msclkid|mc_cid|mc_eid|_ga|_gl|ref)$/i
// Cookies that mean the visitor is signed in to the site: such pages are personal and never cached.
const SESSION_COOKIE = /(^|;\s*)[^=;]*(session|sess|sid|auth|token|jwt|login)[^=;]*=/i

/** The cache key: the page's address without tracking parameters, as a GET request. */
export function lastGoodKey(url: string): string {
  const u = new URL(url)
  for (const name of [...u.searchParams.keys()]) if (TRACKING.test(name)) u.searchParams.delete(name)
  u.searchParams.sort()
  u.hash = ''
  return u.toString()
}

/** A render failure that means Brease couldn't be reached: network, timeout or a 5xx from the API. */
export function isBreaseOutage(err: unknown): boolean {
  return err instanceof BreaseError && (err.code === 'network' || err.status >= 500)
}

function defaultCache(): Cache | undefined {
  return (globalThis as { caches?: { default?: Cache } }).caches?.default
}

function storable(request: Request, response: Response): boolean {
  if (response.status !== 200) return false
  if (!(response.headers.get('content-type') ?? '').includes('text/html')) return false
  if (response.headers.has('set-cookie')) return false
  const cc = response.headers.get('cache-control') ?? ''
  if (/no-store|private/i.test(cc)) return false
  return !SESSION_COOKIE.test(request.headers.get('cookie') ?? '') && !request.headers.has('authorization')
}

/**
 * Renders the page; keeps a copy of good HTML responses, and answers from that copy (marked with
 * `x-brease-stale`) when the render fails because Brease can't be reached.
 *
 *   export default { fetch: (req, env, ctx) => withLastGood(req, () => handler.fetch(req, env, ctx), { waitUntil: (p) => ctx.waitUntil(p) }) }
 */
export async function withLastGood(
  request: Request,
  render: () => Promise<Response>,
  opts: LastGoodOptions & { previewDefault?: boolean } = {}
): Promise<Response> {
  const cache = opts.cache ?? defaultCache()
  const preview = opts.preview ?? opts.previewDefault ?? false
  if (!cache || preview || request.method !== 'GET') return render()
  const personal =
    SESSION_COOKIE.test(request.headers.get('cookie') ?? '') || request.headers.has('authorization')
  const key = new Request(lastGoodKey(request.url), { method: 'GET' })
  const maxAge = opts.maxAgeSeconds ?? DAY

  const stale = async () => {
    if (personal) return null
    const hit = await cache.match(key).catch(() => undefined)
    if (!hit) return null
    const storedAt = Number(hit.headers.get('x-brease-stored-at') ?? 0)
    if (storedAt && Date.now() - storedAt > maxAge * 1000) return null
    const headers = new Headers(hit.headers)
    headers.set('x-brease-stale', new Date(storedAt || Date.now()).toISOString())
    headers.set('cache-control', 'no-store')
    return new Response(hit.body, { status: 200, headers })
  }

  let response: Response
  try {
    response = await render()
  } catch (err) {
    if (!isBreaseOutage(err)) throw err
    const copy = await stale()
    if (copy) return copy
    throw err
  }

  if (response.status >= 500 && opts.onServerError !== false) {
    const copy = await stale()
    if (copy) return copy
    return response
  }

  if (storable(request, response)) {
    const headers = new Headers(response.headers)
    headers.set('cache-control', `public, max-age=${maxAge}`)
    headers.set('x-brease-stored-at', String(Date.now()))
    const stored = cache
      .put(key, new Response(response.clone().body, { status: 200, headers }))
      .catch(() => undefined)
    if (opts.waitUntil) opts.waitUntil(stored)
    else await stored
  }
  return response
}
