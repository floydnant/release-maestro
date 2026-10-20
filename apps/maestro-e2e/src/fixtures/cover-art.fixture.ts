/**
 * Stand-in cover art for renderer scenarios: a gradient sleeve with a disc, hued by its seed, so
 * walls of covers read like real artwork and stay identical between runs.
 *
 * Release artwork takes the data URL directly. Library covers go through the renderer's `fileUrl`,
 * which a browser scenario cannot load, so library rows carry a {@link fixtureCoverPath} instead
 * and the renderer harness swaps each such `file://` image for the sleeve it names.
 */

/** Paths under this root resolve to stand-in art in renderer scenarios. */
export const FIXTURE_COVER_ROOT = '/fixtures/covers'

/** The sleeve's SVG markup. Self-contained so the harness can inline it into the page. */
export const coverArtSvg = (seed: string): string => {
    let hash = 0
    for (const character of seed) hash = (hash * 31 + character.charCodeAt(0)) >>> 0
    const hue = hash % 360
    const accent = (hue + 40 + (hash % 80)) % 360
    const disc = (hue + 180) % 360
    const angle = hash % 2 === 0 ? 'x1="0" y1="0" x2="1" y2="1"' : 'x1="1" y1="0" x2="0" y2="1"'
    return (
        '<svg xmlns="http://www.w3.org/2000/svg" width="300" height="300" viewBox="0 0 300 300">' +
        `<defs><linearGradient id="sleeve" ${angle}>` +
        `<stop offset="0" stop-color="hsl(${hue} 70% 55%)"/>` +
        `<stop offset="1" stop-color="hsl(${accent} 70% 28%)"/>` +
        '</linearGradient></defs>' +
        '<rect width="300" height="300" fill="url(#sleeve)"/>' +
        `<circle cx="150" cy="150" r="90" fill="hsl(${disc} 60% 70% / 0.6)"/>` +
        '<circle cx="150" cy="150" r="8" fill="hsl(0 0% 0% / 0.5)"/>' +
        '</svg>'
    )
}

/** Stand-in art as an `img`-ready data URL, for fields that take a URL. */
export const coverArtDataUrl = (seed: string): string =>
    `data:image/svg+xml,${encodeURIComponent(coverArtSvg(seed))}`

/** A library cover path that renderer scenarios resolve to stand-in art for `seed`. */
export const fixtureCoverPath = (seed: string): string =>
    `${FIXTURE_COVER_ROOT}/${seed.toLowerCase().replace(/[^a-z0-9]+/g, '-')}.svg`

/**
 * Page-side installer: replaces fixture-cover `file://` images with their stand-in art as they
 * appear, keeping the `file://` URL the renderer produced in `data-fixture-src` for assertions.
 * Self-contained; the harness passes it {@link coverArtSvg} and the root as arguments.
 */
export const installFixtureCoverArt = (svgFor: (seed: string) => string, root: string): void => {
    const prefix = `file://${root}/`
    const resolve = (image: HTMLImageElement) => {
        const source = image.getAttribute('src') ?? ''
        if (!source.startsWith(prefix)) return
        const seed = decodeURIComponent(source.slice(prefix.length)).replace(/\.svg$/, '')
        image.dataset['fixtureSrc'] = source
        image.src = `data:image/svg+xml,${encodeURIComponent(svgFor(seed))}`
    }
    const visit = (node: Node) => {
        if (node instanceof HTMLImageElement) resolve(node)
        else if (node instanceof Element) node.querySelectorAll('img').forEach(resolve)
    }
    new MutationObserver(records => {
        for (const record of records) {
            if (record.type === 'attributes') visit(record.target)
            else record.addedNodes.forEach(visit)
        }
    }).observe(document, { subtree: true, childList: true, attributes: true, attributeFilter: ['src'] })
}
