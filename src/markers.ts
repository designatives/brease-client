// Editor markers, so Brease's editor knows what each element shows: data-brease={fieldPath('hero.title')} on
// a field of the page being rendered; a field of another page (site-wide content) names that page's id from
// the delivery response, never a fixed one: data-brease={fieldPath('footer.copyright', global.pageId)}.
// Menus: data-brease={navPath('main')}.
export function fieldPath(path: string, pageId?: string): string {
  return pageId ? `${pageId}:${path}` : path
}

export function navPath(key: string): string {
  return `nav:${key}`
}
