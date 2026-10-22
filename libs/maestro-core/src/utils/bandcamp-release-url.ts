/** One identity for links from email, release pages, and track lists. */
export const normalizeBandcampReleaseUrl = (href: string, base?: string): string | null => {
    const url = URL.parse(href, base)
    if (!url || !['http:', 'https:'].includes(url.protocol)) return null
    url.protocol = 'https:'
    url.search = ''
    url.hash = ''
    return url.href.replace(/\/$/, '')
}
