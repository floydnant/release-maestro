/**
 * The primitives every browse surface's URL round-trip shares.
 *
 * Each surface owns its own param module — `song-query-params.ts`,
 * `album-query-params.ts` — because the keys and the fallbacks are part of that
 * surface's contract. What they have in common is the shape of a filter in a URL: a
 * comma-separated id list, read defensively, compared by value. That much lives here so
 * five surfaces do not carry five copies of it.
 */

/** What the router hands back: values may be absent, a string, or (rarely) repeated. */
export type ReadonlyParams = Record<string, string | string[] | undefined | null>

export const firstValue = (value: string | string[] | undefined | null): string | undefined => {
    if (value == null) return undefined
    return Array.isArray(value) ? value[0] : value
}

/** Parse a comma-separated id list, deduped, dropping blanks. `undefined` when empty. */
export const idList = (value: string | string[] | undefined | null): string[] | undefined => {
    const raw = firstValue(value)
    if (!raw) return undefined
    const ids = [
        ...new Set(
            raw
                .split(',')
                .map(id => id.trim())
                .filter(Boolean),
        ),
    ]
    return ids.length > 0 ? ids : undefined
}

export const idParam = (ids: string[] | undefined): string | null => (ids?.length ? ids.join(',') : null)

/**
 * Value equality for an id list as a filter holds one.
 *
 * An omitted and an empty list mean the same thing — "unfiltered" — so they compare
 * equal. Order is part of the value, because the URL preserves it and the filter chips
 * are shown in it.
 */
export const sameIds = (left: string[] | undefined, right: string[] | undefined): boolean => {
    const leftIds = left ?? []
    const rightIds = right ?? []
    return leftIds.length == rightIds.length && leftIds.every((id, index) => id == rightIds[index])
}
