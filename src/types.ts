export type LocaleStrategy = 'PREFIX_EXCEPT_DEFAULT' | 'PREFIX_ALL' | 'CUSTOM'

export type UrlSettings = {
  locales: string[]
  defaultLocale: string
  localeStrategy: LocaleStrategy
  urlTemplate?: string | null
}

export type Robots = { index?: boolean; follow?: boolean }

export type OpenGraph = { type?: string; title?: string; description?: string; image?: string }

export type Twitter = {
  card?: 'summary' | 'summary_large_image'
  site?: string
  creator?: string
  title?: string
  description?: string
  image?: string
}

export type PageSeo = {
  title?: string
  description?: string
  canonical?: string
  robots?: Robots
  openGraph?: OpenGraph
  twitter?: Twitter
  structuredData?: Record<string, unknown>[]
  customCode?: string
}

export type SiteSeo = PageSeo & {
  titleTemplate?: string
  siteName?: string
  defaultImage?: string
  favicon?: string
  customHead?: string
}

export type ResolvedSeo = {
  title: string
  description?: string
  canonical?: string
  robots: { index: boolean; follow: boolean }
  openGraph: OpenGraph & { url?: string; siteName?: string }
  twitter: Twitter
  structuredData: Record<string, unknown>[]
  alternates: Record<string, string>
  customHead?: string
  customCode?: string
  favicon?: string
}

export type Site = {
  name: string
  locales: string[]
  defaultLocale: string
  localeStrategy: LocaleStrategy
  urlTemplate: string | null
  seo: Record<string, SiteSeo>
}

export type Page<T = Record<string, unknown>> = {
  pageId: string
  name: string
  locale: string
  slug: string
  url: string
  hidden: boolean
  content: T
  seo: PageSeo
  resolvedSeo: ResolvedSeo
  alternates: Record<string, string>
}

export type PageRef = Pick<Page, 'pageId' | 'locale' | 'slug' | 'url' | 'hidden'>

export type NavigationItem = {
  id: string
  label: string
  url: string
  pageId?: string
  target?: '_self' | '_blank'
  children: NavigationItem[]
}

export type Navigation = { key: string; locale: string; items: NavigationItem[] }

export type Redirect = { source: string; destination: string; status: 301 | 302 | 307 | 308 }

export type Release = { id: string; number: number; commitSha: string; liveAt: string | null }

export type SitemapEntry = { url: string; lastModified?: string; alternates: Record<string, string> }
