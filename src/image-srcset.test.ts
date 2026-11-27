import { describe, expect, it } from 'vitest'
import { imageProps, variantUrl } from './image'

// PERF-37: Brease's resized WebP copies become a srcSet.
const image = {
  assetId: 'ast_1',
  url: 'https://media.brease.io/site_1/ast_1/hero.jpg',
  alt: 'Hero',
  width: 2400,
  height: 1600,
  widths: [640, 320, 1280]
}

describe('imageProps with resized copies', () => {
  it('lists each copy and the original, smallest first', () => {
    expect(imageProps(image)).toEqual({
      src: image.url,
      srcSet: [
        `${image.url}.w320.webp 320w`,
        `${image.url}.w640.webp 640w`,
        `${image.url}.w1280.webp 1280w`,
        `${image.url} 2400w`
      ].join(', '),
      sizes: '100vw',
      alt: 'Hero',
      width: 2400,
      height: 1600
    })
  })

  it('keeps to the widths asked for and the sizes given', () => {
    const props = imageProps(image, { widths: [640], sizes: '50vw' })
    expect(props.srcSet).toBe(`${image.url}.w640.webp 640w, ${image.url} 2400w`)
    expect(props.sizes).toBe('50vw')
  })

  it('has no srcSet without copies', () => {
    expect(imageProps({ ...image, widths: [] })).not.toHaveProperty('srcSet')
    expect(imageProps({ assetId: 'a', url: 'u' })).toEqual({ src: 'u' })
  })

  it('puts the width before a query string', () => {
    expect(variantUrl('https://m.example/a.png?v=2', 640)).toBe('https://m.example/a.png.w640.webp?v=2')
  })
})
