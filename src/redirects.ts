import type { Redirect } from './types'

// Redirects managed in Brease, applied per request (in a proxy or middleware), so a new redirect works as
// soon as it's published, with no rebuild. Sources are paths with optional parameters, as in Next's
// redirects: "/old", "/blog/:slug", "/docs/:rest*" (any number of segments); the destination may use them.
export function matchRedirect(
  redirects: Redirect[],
  pathname: string
): { destination: string; status: Redirect['status'] } | null {
  const path = normalize(pathname)
  for (const r of redirects) {
    const params = matchSource(normalize(r.source), path)
    if (!params) continue
    const destination = r.destination.replace(/:([A-Za-z_][A-Za-z0-9_]*)\*?/g, (whole, name: string) =>
      name in params ? (params[name] as string) : whole
    )
    if (normalize(destination) === path) continue
    return { destination, status: r.status }
  }
  return null
}

const normalize = (p: string) => (p.length > 1 ? p.replace(/\/+$/, '') : p) || '/'

function matchSource(source: string, path: string): Record<string, string> | null {
  const want = source.split('/').filter(Boolean)
  const have = path.split('/').filter(Boolean)
  const params: Record<string, string> = {}
  for (let i = 0; i < want.length; i++) {
    const seg = want[i] as string
    const rest = /^:([A-Za-z_][A-Za-z0-9_]*)\*$/.exec(seg)
    if (rest) {
      params[rest[1] as string] = have.slice(i).join('/')
      return params
    }
    const value = have[i]
    if (value === undefined) return null
    const param = /^:([A-Za-z_][A-Za-z0-9_]*)$/.exec(seg)
    if (param) params[param[1] as string] = value
    else if (decodeURIComponent(value) !== decodeURIComponent(seg)) return null
  }
  return want.length === have.length ? params : null
}
