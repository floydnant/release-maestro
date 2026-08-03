import {
    DEFAULT_SONG_SORT,
    SongPresence,
    SongSortField,
    emptySongQuery,
    type SongFilter,
    type SongQuery,
    type SortDirection,
} from '@release-maestro/core'

/**
 * A {@link SongQuery} as URL query params, and back.
 *
 * Browse state lives in the URL and nowhere else: back and forward restore a filter,
 * a sort and a search, and nothing survives an app restart. That is a deliberate
 * choice (MAE-61) — a track list you cannot link to or step back through is worse
 * than one that forgets.
 *
 * Params are read defensively. A hand-edited or stale URL narrows or falls back to a
 * default; it never throws and never renders an error page.
 */

export const SongQueryParam = {
    search: 'q',
    sort: 'sort',
    direction: 'dir',
    artist: 'artist',
    genre: 'genre',
    recordLabel: 'label',
    album: 'album',
    presence: 'presence',
} as const

/** The params this module owns, so a caller can clear them without clearing others. */
export type SongQueryParams = Partial<Record<(typeof SongQueryParam)[keyof typeof SongQueryParam], string>>

/** What the router hands back: values may be absent, a string, or (rarely) repeated. */
export type ReadonlyParams = Record<string, string | string[] | undefined | null>

const SORT_FIELDS = new Set<string>(Object.values(SongSortField))
const PRESENCES = new Set<string>(Object.values(SongPresence))

export const songQueryFromParams = (params: ReadonlyParams): SongQuery => {
    const sortField = firstValue(params[SongQueryParam.sort])
    const direction = firstValue(params[SongQueryParam.direction])
    const presence = firstValue(params[SongQueryParam.presence])

    const filter: SongFilter = {
        artistIds: idList(params[SongQueryParam.artist]),
        genreIds: idList(params[SongQueryParam.genre]),
        recordLabelIds: idList(params[SongQueryParam.recordLabel]),
        albumIds: idList(params[SongQueryParam.album]),
        presence: presence != null && PRESENCES.has(presence) ? (presence as SongPresence) : undefined,
    }

    return {
        ...emptySongQuery(),
        search: firstValue(params[SongQueryParam.search]) ?? '',
        sort: {
            field:
                sortField != null && SORT_FIELDS.has(sortField)
                    ? (sortField as SongSortField)
                    : DEFAULT_SONG_SORT.field,
            direction: direction == 'asc' || direction == 'desc' ? direction : DEFAULT_SONG_SORT.direction,
        },
        filter: stripEmpty(filter),
    }
}

/**
 * The params for a query, with defaults left out.
 *
 * Every key this module owns is always present — set to `null` when it does not
 * apply — because the router merges rather than replaces, and an omitted key would
 * leave a stale filter in the URL after the user removed it.
 */
export const songQueryToParams = (query: SongQuery): Record<string, string | null> => ({
    [SongQueryParam.search]: query.search.trim() || null,
    [SongQueryParam.sort]: query.sort.field == DEFAULT_SONG_SORT.field ? null : query.sort.field,
    [SongQueryParam.direction]: directionParam(query),
    [SongQueryParam.artist]: idParam(query.filter.artistIds),
    [SongQueryParam.genre]: idParam(query.filter.genreIds),
    [SongQueryParam.recordLabel]: idParam(query.filter.recordLabelIds),
    [SongQueryParam.album]: idParam(query.filter.albumIds),
    [SongQueryParam.presence]:
        query.filter.presence == null || query.filter.presence == SongPresence.any
            ? null
            : query.filter.presence,
})

// ---------------------------------------------------------------------------

/**
 * The direction is only a default *relative to its field*, so it has to be written
 * out whenever the field is non-default — otherwise sorting by title ascending and
 * by title descending would produce the same URL.
 */
const directionParam = (query: SongQuery): string | null => {
    if (query.sort.field != DEFAULT_SONG_SORT.field) return query.sort.direction
    return query.sort.direction == DEFAULT_SONG_SORT.direction ? null : query.sort.direction
}

const firstValue = (value: string | string[] | undefined | null): string | undefined => {
    if (value == null) return undefined
    return Array.isArray(value) ? value[0] : value
}

const idList = (value: string | string[] | undefined | null): string[] | undefined => {
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

const idParam = (ids: string[] | undefined): string | null => (ids?.length ? ids.join(',') : null)

/** Drop empty id lists so two equivalent filters compare equal by value. */
const stripEmpty = (filter: SongFilter): SongFilter => {
    const stripped: SongFilter = {}
    if (filter.artistIds?.length) stripped.artistIds = filter.artistIds
    if (filter.genreIds?.length) stripped.genreIds = filter.genreIds
    if (filter.recordLabelIds?.length) stripped.recordLabelIds = filter.recordLabelIds
    if (filter.albumIds?.length) stripped.albumIds = filter.albumIds
    if (filter.presence != null && filter.presence != SongPresence.any) {
        stripped.presence = filter.presence
    }
    return stripped
}

/** Toggle a sort: same column flips direction, a new column starts in its natural one. */
export const nextSort = (current: SongQuery['sort'], field: SongSortField): SongQuery['sort'] => {
    if (current.field == field) {
        return { field, direction: current.direction == 'asc' ? 'desc' : 'asc' }
    }
    return { field, direction: naturalDirection(field) }
}

/**
 * Which way a column reads first. Text starts A–Z; numbers and dates start with the
 * biggest or newest, because that is what a DJ is looking for when they click
 * "BPM" or "Date added".
 */
const naturalDirection = (field: SongSortField): SortDirection =>
    field == SongSortField.dateAdded ||
    field == SongSortField.year ||
    field == SongSortField.bpm ||
    field == SongSortField.duration
        ? 'desc'
        : 'asc'
