import type { BreaseImage } from './types'

// Brease files are plain objects in an S3 bucket, with no resizing on the storage side: URLs pass through,
// and resizing is left to the site's image pipeline (e.g. next/image with the bucket in remotePatterns). The
// options are ignored; they stay so existing calls keep compiling.

export function imageUrl(
  src: string,
  _opts: { width?: number; height?: number; quality?: number; resize?: 'cover' | 'contain' | 'fill' } = {}
): string {
  return src
}

// For an image field ({ assetId, url, alt, width, height }) or a plain URL. No srcSet or sizes: there is only
// the one file. The options are ignored (see above).
export function imageProps(
  image: string | BreaseImage,
  _opts: { sizes?: string; widths?: number[]; width?: number; height?: number; quality?: number } = {}
): { src: string; srcSet?: string; sizes?: string; alt?: string; width?: number; height?: number } {
  const src = typeof image === 'string' ? image : image.url
  const extra =
    typeof image === 'string'
      ? {}
      : {
          ...(image.alt !== undefined ? { alt: image.alt } : {}),
          ...(image.width ? { width: image.width } : {}),
          ...(image.height ? { height: image.height } : {})
        }
  return { src, ...extra }
}
