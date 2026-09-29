export class BreaseError extends Error {
  override name = 'BreaseError'

  constructor(
    public code: string,
    message: string,
    public status: number,
    public requestId?: string,
    public details?: unknown
  ) {
    super(message)
  }

  static async fromResponse(res: Response): Promise<BreaseError> {
    const requestId = res.headers.get('x-request-id') ?? res.headers.get('x-vercel-id') ?? undefined
    let code = res.status === 429 ? 'rate_limited' : res.status >= 500 ? 'upstream' : 'http_error'
    let message = `Brease API responded ${res.status}`
    let details: unknown
    try {
      const body = (await res.json()) as { error?: { code?: string; message?: string; details?: unknown } }
      if (body?.error) {
        code = body.error.code ?? code
        message = body.error.message ?? message
        details = body.error.details
      }
    } catch {}
    return new BreaseError(code, message, res.status, requestId ?? undefined, details)
  }
}
