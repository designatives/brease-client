import type { BreaseImage } from './types'

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

// For an image field ({ assetId, url, alt, width, height }) or a plain URL.
export function imageProps(
  image: string | BreaseImage,
  opts: { sizes?: string; widths?: number[]; width?: number; height?: number; quality?: number } = {}
): { src: string; srcSet: string; sizes: string; alt?: string; width?: number; height?: number } {
  const src = typeof image === 'string' ? image : image.url
  const extra =
    typeof image === 'string'
      ? {}
      : {
          ...(image.alt !== undefined ? { alt: image.alt } : {}),
          ...(image.width ? { width: image.width } : {}),
          ...(image.height ? { height: image.height } : {})
        }
  return { src: imageUrl(src), srcSet: srcset(src), sizes: opts.sizes ?? '100vw', ...extra }
}
