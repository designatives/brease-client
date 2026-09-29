import { type HeadOptions, headTags } from './html'
import type { ResolvedSeo } from './types'

export type { HeadOptions, HeadTag } from './html'
export { headTagList, headTags } from './html'

// In a layout: <Fragment set:html={breaseHead(page.resolvedSeo)} />
export function breaseHead(seo: ResolvedSeo, opts?: HeadOptions): string {
  return headTags(seo, opts)
}
