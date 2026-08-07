import {
    AlbumSortField,
    DEFAULT_ALBUM_SORT,
    emptyAlbumQuery,
    type AlbumFilter,
    type AlbumQuery,
    type SortDirection,
} from '@release-maestro/core'
import { firstValue, idList, idParam, sameIds, type ReadonlyParams } from './query-params.utils'

/**
 * An {@link AlbumQuery} as URL query params, and back — the album half of what
 * `song-query-params.ts` does for the track list, and the same contract: browse state
 * lives in the URL and nowhere else, so back and forward restore a filter, a sort and
 * a search, and nothing survives an app restart (MAE-61).
 *
 * Params are read defensively. A hand-edited or stale URL narrows or falls back to a
 * default; it never throws and never renders an error page.
 *
 * The keys deliberately match the track list's where they mean the same thing —
 * `q`, `sort`, `dir`, `recordLabel`, `genre` — because the two pages sit side by side
 * and a user who has learned one URL should be able to read the other. `albumArtist`
 * is its own key rather than `artist`: on an album, being the album artist and playing
 * on one track are different claims, and the track list's `artist` means the latter.
 */

export const AlbumQueryParam = {
    search: 'q',
    sort: 'sort',
    direction: 'dir',
    albumArtist: 'albumArtist',
    recordLabel: 'recordLabel',
    genre: 'genre',
} as const

/** The params this module owns, so a caller can clear them without clearing others. */
export type AlbumQueryParams = Partial<Record<(typeof AlbumQueryParam)[keyof typeof AlbumQueryParam], string>>

const SORT_FIELDS = new Set<string>(Object.values(AlbumSortField))

export const albumQueryFromParams = (params: ReadonlyParams): AlbumQuery => {
    const sortField = firstValue(params[AlbumQueryParam.sort])
    const direction = firstValue(params[AlbumQueryParam.direction])

    const filter: AlbumFilter = {
        albumArtistIds: idList(params[AlbumQueryParam.albumArtist]),
        recordLabelIds: idList(params[AlbumQueryParam.recordLabel]),
        genreIds: idList(params[AlbumQueryParam.genre]),
    }

    return {
        ...emptyAlbumQuery(),
        search: firstValue(params[AlbumQueryParam.search]) ?? '',
        sort: {
            field:
                sortField != null && SORT_FIELDS.has(sortField)
                    ? (sortField as AlbumSortField)
                    : DEFAULT_ALBUM_SORT.field,
            direction: direction == 'asc' || direction == 'desc' ? direction : DEFAULT_ALBUM_SORT.direction,
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
export const albumQueryToParams = (query: AlbumQuery): Record<string, string | null> => ({
    [AlbumQueryParam.search]: query.search.trim() || null,
    [AlbumQueryParam.sort]: query.sort.field == DEFAULT_ALBUM_SORT.field ? null : query.sort.field,
    [AlbumQueryParam.direction]: directionParam(query),
    [AlbumQueryParam.albumArtist]: idParam(query.filter.albumArtistIds),
    [AlbumQueryParam.recordLabel]: idParam(query.filter.recordLabelIds),
    [AlbumQueryParam.genre]: idParam(query.filter.genreIds),
})

// ---------------------------------------------------------------------------

/**
 * The direction is only a default *relative to its field*, so it has to be written out
 * whenever the field is non-default — otherwise sorting by year ascending and by year
 * descending would produce the same URL.
 */
const directionParam = (query: AlbumQuery): string | null => {
    if (query.sort.field != DEFAULT_ALBUM_SORT.field) return query.sort.direction
    return query.sort.direction == DEFAULT_ALBUM_SORT.direction ? null : query.sort.direction
}

/** Drop empty id lists so two equivalent filters compare equal by value. */
const stripEmpty = (filter: AlbumFilter): AlbumFilter => {
    const stripped: AlbumFilter = {}
    if (filter.albumArtistIds?.length) stripped.albumArtistIds = filter.albumArtistIds
    if (filter.recordLabelIds?.length) stripped.recordLabelIds = filter.recordLabelIds
    if (filter.genreIds?.length) stripped.genreIds = filter.genreIds
    return stripped
}

/** Toggle a sort: same column flips direction, a new column starts in its natural one. */
export const nextAlbumSort = (current: AlbumQuery['sort'], field: AlbumSortField): AlbumQuery['sort'] => {
    if (current.field == field) {
        return { field, direction: current.direction == 'asc' ? 'desc' : 'asc' }
    }
    return { field, direction: naturalAlbumDirection(field) }
}

/**
 * Which way a column reads first. Text starts A–Z; a date and a year start with the
 * newest, because the records someone clicking either is looking for are the ones they
 * just got.
 */
const DESCENDING_FIRST = new Set<AlbumSortField>([AlbumSortField.dateAdded, AlbumSortField.year])

const naturalAlbumDirection = (field: AlbumSortField): SortDirection =>
    DESCENDING_FIRST.has(field) ? 'desc' : 'asc'

/** Value equality for an album query, so a rebuilt but identical one is not a change. */
export const sameAlbumQuery = (left: AlbumQuery, right: AlbumQuery): boolean =>
    left.search == right.search &&
    left.sort.field == right.sort.field &&
    left.sort.direction == right.sort.direction &&
    sameAlbumFilter(left.filter, right.filter)

/**
 * Separate from {@link sameAlbumQuery} because the filter is the only part of a query
 * the chip names depend on: a sort click rebuilds the query object, and identity
 * equality would send that rebuilt-but-equal filter back over IPC to resolve names
 * nobody asked to change.
 */
export const sameAlbumFilter = (left: AlbumFilter, right: AlbumFilter): boolean =>
    sameIds(left.albumArtistIds, right.albumArtistIds) &&
    sameIds(left.recordLabelIds, right.recordLabelIds) &&
    sameIds(left.genreIds, right.genreIds)
