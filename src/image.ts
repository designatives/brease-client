export type Resize = 'cover' | 'contain' | 'fill'

export type ImageOptions = { width?: number; height?: number; quality?: number; resize?: Resize }

const OBJECT_PATH = '/storage/v1/object/public/'
const RENDER_PATH = '/storage/v1/render/image/public/'
export const DEFAULT_WIDTHS = [320, 640, 960, 1280, 1920]

export function isSupabaseImage(src: string): boolean {
  return src.includes(OBJECT_PATH) || src.includes(RENDER_PATH)
}

// Rewrites a Supabase public object URL to its image transformation URL; other URLs pass through.
export function imageUrl(src: string, opts: ImageOptions = {}): string {
  if (!isSupabaseImage(src)) return src
  let url: URL
  try {
    url = new URL(src.replace(OBJECT_PATH, RENDER_PATH))
  } catch {
    return src
  }
  if (opts.width) url.searchParams.set('width', String(Math.round(opts.width)))
  if (opts.height) url.searchParams.set('height', String(Math.round(opts.height)))
  if (opts.quality) url.searchParams.set('quality', String(opts.quality))
  if (opts.resize) url.searchParams.set('resize', opts.resize)
  return url.toString()
}

export function srcset(
  src: string,
  opts: { widths?: number[]; quality?: number; resize?: Resize } = {}
): string {
  if (!isSupabaseImage(src)) return ''
  return (opts.widths ?? DEFAULT_WIDTHS)
    .map((w) => `${imageUrl(src, { width: w, quality: opts.quality, resize: opts.resize })} ${w}w`)
    .join(', ')
}

export function imageProps(
  src: string,
  opts: { sizes?: string; widths?: number[]; width?: number; height?: number; quality?: number } = {}
): { src: string; srcSet: string; sizes: string } {
  return {
    src: imageUrl(src, { width: opts.width, height: opts.height, quality: opts.quality }),
    srcSet: srcset(src, { widths: opts.widths, quality: opts.quality }),
    sizes: opts.sizes ?? '100vw'
  }
}
