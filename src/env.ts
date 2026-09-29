// Safe in browsers, Deno and edge runtimes where `process` may not exist.
export function env(name: string): string | undefined {
  const proc = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process
  const value = proc?.env?.[name]
  return value === '' ? undefined : value
}
