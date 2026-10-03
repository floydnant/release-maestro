import type { ExternalRefKeys, ExternalRefs } from '@release-maestro/core'

export interface ExternalLink {
    label: string
    url: string
}

/** How one kind of stored reference becomes a link: an ID appended to `base`, or a URL on `domain`. */
export type ExternalLinkSpec = { label: string; key: ExternalRefKeys } & (
    { base: string } | { domain: string }
)

/**
 * Turns stored references into links a user can open. A URL has to be http(s) and sit on the
 * service's domain or one of its subdomains (Bandcamp pages live on `name.bandcamp.com`), so a
 * tag cannot put a service's name on an unrelated site. Repeats are dropped, and several links to
 * one service are numbered.
 */
export const externalLinks = (refs: ExternalRefs, specs: ExternalLinkSpec[]): ExternalLink[] => {
    const byLabel = new Map<string, Set<string>>()
    for (const spec of specs) {
        const domain = 'base' in spec ? new URL(spec.base).hostname : spec.domain
        const urls = byLabel.get(spec.label) ?? new Set<string>()
        byLabel.set(spec.label, urls)
        for (const value of refs[spec.key] ?? []) {
            const trimmed = value.trim()
            if (!trimmed) continue
            const url = 'base' in spec ? spec.base + encodeURIComponent(trimmed) : trimmed
            if (isOnDomain(url, domain)) urls.add(url)
        }
    }
    return [...byLabel].flatMap(([label, values]) => {
        const urls = [...values].sort()
        return urls.map((url, index) => ({
            label: urls.length > 1 ? `${label} ${index + 1}` : label,
            url,
        }))
    })
}

/** Bandcamp IDs have no public URL, so the honest link is a search for the name. */
export const bandcampSearchLink = (name: string): ExternalLink => ({
    label: 'Search Bandcamp',
    url: `https://bandcamp.com/search?q=${encodeURIComponent(name)}`,
})

const isOnDomain = (url: string, domain: string): boolean => {
    try {
        const { protocol, hostname } = new URL(url)
        return (
            (protocol == 'https:' || protocol == 'http:') &&
            (hostname == domain || hostname.endsWith(`.${domain}`))
        )
    } catch {
        return false
    }
}
