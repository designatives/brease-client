// next is an optional peer; this keeps the package typecheckable without it installed.
declare module 'next/cache' {
  export function revalidatePath(path: string, type?: 'page' | 'layout'): void
  export function revalidateTag(tag: string, profile?: string): void
}
