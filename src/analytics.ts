import type { Site } from './types'

// The GA4 tag Brease turns on for a site (Brease → Connections → Google). Consent mode starts with every
// storage type denied, so nothing is stored until the site's cookie banner calls grantAnalytics().
export type Ga4Tag = { id: string; src: string; inline: string }

const MEASUREMENT_ID = /^G-[A-Z0-9]+$/

export function ga4Tag(site: Pick<Site, 'analytics'>): Ga4Tag | null {
  const id = site.analytics?.ga4
  if (!id || !MEASUREMENT_ID.test(id)) return null
  const inline = [
    'window.dataLayer=window.dataLayer||[];function gtag(){dataLayer.push(arguments);}',
    "gtag('consent','default',{ad_storage:'denied',ad_user_data:'denied',ad_personalization:'denied',analytics_storage:'denied',wait_for_update:500});",
    "gtag('js',new Date());",
    `gtag('config','${id}');`
  ].join('')
  return { id, src: `https://www.googletagmanager.com/gtag/js?id=${id}`, inline }
}

// For server-rendered HTML (Astro, plain HTML): both script tags, or an empty string when the tag is off.
export function ga4Html(site: Pick<Site, 'analytics'>): string {
  const tag = ga4Tag(site)
  return tag ? `<script async src="${tag.src}"></script>\n<script>${tag.inline}</script>` : ''
}

type Gtag = (...args: unknown[]) => void

// Call from the cookie banner once the visitor accepts (or withdraws) analytics cookies.
export function grantAnalytics(granted = true) {
  const gtag = (globalThis as { gtag?: Gtag }).gtag
  gtag?.('consent', 'update', { analytics_storage: granted ? 'granted' : 'denied' })
}
