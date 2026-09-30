export type Resize = 'cover' | 'contain' | 'fill'

export type ImageOptions = { width?: number; height?: number; quality?: number; resize?: Resize }

export const DEFAULT_WIDTHS = [320, 640, 960, 1280, 1920]

// Brease files are plain objects in an S3 bucket, with no resizing on the storage side: URLs pass through,
// and resizing is left to the site's image pipeline (e.g. next/image with the bucket in remotePatterns).
export function imageUrl(src: string, _opts: ImageOptions = {}): string {
  return src
}

export function srcset(
  _src: string,
  _opts: { widths?: number[]; quality?: number; resize?: Resize } = {}
): string {
  return ''
}

export function imageProps(
  src: string,
  opts: { sizes?: string; widths?: number[]; width?: number; height?: number; quality?: number } = {}
): { src: string; srcSet: string; sizes: string } {
  return { src: imageUrl(src), srcSet: srcset(src), sizes: opts.sizes ?? '100vw' }
}
