import {
    DEFAULT_SONG_SORT,
    SongPresence,
    SongSortField,
    emptySongQuery,
    type SongFilter,
    type SongQuery,
    type SortDirection,
} from '@release-maestro/core'
import { firstValue, idList, idParam, type ReadonlyParams } from './query-params.utils'

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
 *
 * The keys are the glossary's names, not abbreviations of them — a URL is a surface
 * users read, and `recordLabel` is the two-word name everywhere outside the raw
 * `metadata.label` tag. `q` is the exception, by the convention every search box on
 * the web already taught them.
 */

export const SongQueryParam = {
    search: 'q',
    sort: 'sort',
    direction: 'dir',
    artist: 'artist',
    genre: 'genre',
    recordLabel: 'recordLabel',
    album: 'album',
    presence: 'presence',
} as const

/** The params this module owns, so a caller can clear them without clearing others. */
export type SongQueryParams = Partial<Record<(typeof SongQueryParam)[keyof typeof SongQueryParam], string>>

export type { ReadonlyParams } from './query-params.utils'

const SORT_FIELDS = new Set<string>(Object.values(SongSortField))
const PRESENCES = new Set<string>(Object.values(SongPresence))

/**
 * The sort the params ask for, falling back to `fallback` for anything they do not say.
 *
 * The fallback is a parameter because "no sort in the URL" does not mean the same thing
 * on every surface: the track list reads it as date added, and an album's track list
 * reads it as track number. Both still accept any field the other can write, so a URL
 * stays meaningful when it moves between them.
 */
export const songSortFromParams = (
    params: ReadonlyParams,
    fallback: SongQuery['sort'] = DEFAULT_SONG_SORT,
): SongQuery['sort'] => {
    const field = firstValue(params[SongQueryParam.sort])
    const direction = firstValue(params[SongQueryParam.direction])

    return {
        field: field != null && SORT_FIELDS.has(field) ? (field as SongSortField) : fallback.field,
        direction: direction == 'asc' || direction == 'desc' ? direction : fallback.direction,
    }
}

export const songQueryFromParams = (params: ReadonlyParams): SongQuery => {
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
        sort: songSortFromParams(params),
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
