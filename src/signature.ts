// Signed requests from Brease (content refreshes): `x-brease-timestamp` and `x-brease-signature`, an
// HMAC-SHA256 of `${timestamp}.${body}`, valid for 5 minutes. Framework-free: works in any fetch runtime.

const MAX_SKEW_MS = 5 * 60_000

export type RevalidateBody = {
  urls?: string[]
  paths?: string[]
  tags?: string[]
  releaseId?: string
  siteId?: string
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

export type RevalidateTarget =
  | { ok: true; paths: string[]; tags: string[]; body: RevalidateBody }
  | { ok: false; reason: 'signature' | 'body' }

// A refresh request from Brease, checked: what to refresh (pathnames and cache tags), or why not (a wrong or
// expired signature answers 401, a body that isn't JSON 400). For any framework's route handler;
// brease-client/next wraps it for Next.
export async function verifyRevalidate(
  req: { text(): Promise<string>; headers: { get(name: string): string | null } },
  secret: string
): Promise<RevalidateTarget> {
  const raw = await req.text()
  const ok = await verifySignature(
    raw,
    req.headers.get('x-brease-timestamp'),
    req.headers.get('x-brease-signature'),
    secret
  )
  if (!ok) return { ok: false, reason: 'signature' }
  let body: RevalidateBody
  try {
    body = JSON.parse(raw || '{}') as RevalidateBody
  } catch {
    return { ok: false, reason: 'body' }
  }
  const paths = new Set<string>(body.paths ?? [])
  for (const url of body.urls ?? []) {
    try {
      paths.add(new URL(url, 'http://localhost').pathname)
    } catch {}
  }
  return { ok: true, paths: [...paths], tags: ['brease', ...(body.tags ?? [])], body }
}
