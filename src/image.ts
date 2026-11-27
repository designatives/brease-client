import type { BreaseImage } from './types'

// Brease files are plain objects in a bucket: imageUrl passes URLs through (resizing on request is left to the
// site's image pipeline, e.g. next/image). The options are ignored; they stay so existing calls keep compiling.

export function imageUrl(
  src: string,
  _opts: { width?: number; height?: number; quality?: number; resize?: 'cover' | 'contain' | 'fill' } = {}
): string {
  return src
}

// For an image field ({ assetId, url, alt, width, height, widths }) or a plain URL. Brease makes resized WebP copies
// of library images and lists their widths in `widths` (delivery API); with them, srcSet lists each copy
// (`<url>.w<width>.webp`) and the original, and `sizes` defaults to 100vw. Without them there is only the one file.
// Sites that resize through their own pipeline (e.g. next/image) can ignore srcSet.
export function imageProps(
  image: string | BreaseImage,
  opts: { sizes?: string; widths?: number[]; width?: number; height?: number; quality?: number } = {}
): { src: string; srcSet?: string; sizes?: string; alt?: string; width?: number; height?: number } {
  const src = typeof image === 'string' ? image : image.url
  if (typeof image === 'string') return { src }
  const extra = {
    ...(image.alt !== undefined ? { alt: image.alt } : {}),
    ...(image.width ? { width: image.width } : {}),
    ...(image.height ? { height: image.height } : {})
  }
  const available = (image.widths ?? []).filter((w) => Number.isInteger(w) && w > 0)
  const wanted = opts.widths?.length ? available.filter((w) => opts.widths?.includes(w)) : available
  if (!wanted.length) return { src, ...extra }
  const entries = [...wanted].sort((a, b) => a - b).map((w) => `${variantUrl(src, w)} ${w}w`)
  if (image.width && !wanted.includes(image.width)) entries.push(`${src} ${image.width}w`)
  return { src, srcSet: entries.join(', '), sizes: opts.sizes ?? '100vw', ...extra }
}

// The resized copy of a Brease image at one of its listed widths (see imageProps).
export const variantUrl = (url: string, width: number) => {
  const [path, query] = url.split('?')
  return `${path}.w${width}.webp${query ? `?${query}` : ''}`
}
