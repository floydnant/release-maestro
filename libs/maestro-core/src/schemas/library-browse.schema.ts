/**
 * The library **read side**: how a browse surface asks for catalog rows.
 *
 * Everything here follows
 * [ADR 0004](../../../../docs/adr/0004-browse-queries-are-windowed-and-selections-carry-a-query.md):
 * the library is designed for 50k–500k songs, so no browse surface ever loads the
 * catalog into the renderer. A surface sends a {@link SongQuery} plus a
 * {@link BrowseWindow} and gets back only the rows currently on screen, plus one
 * total for the scrollbar.
 *
 * Vocabulary is the music-library glossary: **song** in code, *track* in copy;
 * **album** in code, *release* in copy.
 */

// ---------------------------------------------------------------------------
// Browse windowing — the shape shared by every browse surface
// ---------------------------------------------------------------------------

export const LibraryBrowseIpcChannel = {
    querySongs: 'library:query-songs',
    describeSongFilter: 'library:describe-song-filter',
} as const

export type LibraryBrowseIpcChannel = (typeof LibraryBrowseIpcChannel)[keyof typeof LibraryBrowseIpcChannel]

/** Hard ceiling on rows per window, enforced in the main process. A viewport is never this tall. */
export const BROWSE_WINDOW_MAX_LIMIT = 500

/** The slice of an ordering a surface currently needs — a `LIMIT`/`OFFSET` pair. */
export interface BrowseWindow {
    /** Index of the first row, within the full ordering. */
    offset: number
    /** How many rows to return. Clamped to {@link BROWSE_WINDOW_MAX_LIMIT}. */
    limit: number
}

/**
 * One window of an ordering. `total` is the row count of the *whole* query, not of
 * `rows` — it is what gives a virtual scrollbar its height, and what a range-based
 * selection is checked against for drift (ADR 0004).
 */
export interface BrowseWindowResult<TRow> {
    rows: TRow[]
    /** Echoed back so a late response can be matched to the window that asked for it. */
    offset: number
    total: number
}

export type SortDirection = 'asc' | 'desc'

/** An entity reduced to what a chip, link or facet needs. */
export interface CatalogEntityRef {
    id: string
    name: string
}

// ---------------------------------------------------------------------------
// SongQuery — filter + sort + search
// ---------------------------------------------------------------------------

/**
 * Sortable song columns. Every one of these is backed by an index on `songs`
 * (see the `mae-118-browse-sort-indexes` migration) — deep `OFFSET` over an
 * unindexed `ORDER BY` makes SQLite build a temp B-tree per query, so adding a
 * member here is a schema change, not a UI change.
 */
export const SongSortField = {
    title: 'title',
    artist: 'artist',
    /** *Release* in copy — sorts on the album title denormalized onto the song. */
    release: 'release',
    genre: 'genre',
    bpm: 'bpm',
    musicalKey: 'musicalKey',
    duration: 'duration',
    year: 'year',
    recordLabel: 'recordLabel',
    /** `songs.createdAt` (the file's creation time) stands in until MAE-116 lands a real `addedAt`. */
    dateAdded: 'dateAdded',
} as const

export type SongSortField = (typeof SongSortField)[keyof typeof SongSortField]

export interface SongSort {
    field: SongSortField
    direction: SortDirection
}

/**
 * Whether missing songs (`present = false`) are in scope. Missing songs are
 * included by default — a DJ with an unplugged drive still wants to see their
 * tracks — and every row carries its own `present` flag so the UI can mark them.
 */
export const SongPresence = {
    any: 'any',
    present: 'present',
    missing: 'missing',
} as const

export type SongPresence = (typeof SongPresence)[keyof typeof SongPresence]

/**
 * Filters address **entities**, never text: `artistIds` matches rows through
 * `song_artists`, not through a `LIKE` on `artist_text`. Display and query
 * deliberately disagree — the artist cell shows `Burial & Four Tet` verbatim while
 * each segment filters by its own artist id.
 *
 * Within one field, ids are OR-ed; across fields they are AND-ed. Omitted and
 * empty arrays both mean "unfiltered", so a filter is comparable by value.
 */
export interface SongFilter {
    artistIds?: string[]
    genreIds?: string[]
    /** Record labels reach songs through their album — `songs` has no label FK. */
    recordLabelIds?: string[]
    albumIds?: string[]
    presence?: SongPresence
}

/**
 * A filter + sort + search, and the unit every browse surface passes around. It is
 * also what a selection is relative to (see {@link SongSelection}) and what
 * playback will resolve in the main process (MAE-117).
 */
export interface SongQuery {
    filter: SongFilter
    sort: SongSort
    /**
     * Free-text search across title, artist, album and record label. Empty means
     * no search. `LIKE '%…%'` today, behind one seam in the query layer — it will
     * not hold at the top of the size range, and swapping in FTS5 is that one file.
     */
    search: string
}

export const DEFAULT_SONG_SORT: SongSort = { field: SongSortField.dateAdded, direction: 'desc' }

export const emptySongQuery = (): SongQuery => ({
    filter: {},
    sort: { ...DEFAULT_SONG_SORT },
    search: '',
})

// ---------------------------------------------------------------------------
// Row DTOs
// ---------------------------------------------------------------------------

/**
 * One segment of an artist credit: an artist, the name they are credited as here,
 * and the phrase joining this segment to the next. Concatenating
 * `creditedAs + joinPhrase` in order reproduces `artistText` exactly, which is why
 * the UI can show the credit verbatim while still addressing each artist entity.
 *
 * **Today every credit has exactly one segment** spanning the whole string, because
 * ingest never splits a raw name — splitting is a user-confirmed act that MAE-97
 * owns. The single segment is the degenerate case, not the model: do not flatten
 * this to a plain id because it currently looks redundant.
 */
export interface ArtistCreditSegment {
    artistId: string
    creditedAs: string
    /** Text between this segment and the next; empty on the last segment. */
    joinPhrase: string
}

/** One row of the track list. Values are `null` where the tag was absent. */
export interface SongRow {
    id: string
    /** Absolute filesystem path — the only stable thing a missing song still has. */
    path: string
    /** `false` once a scan could not find the file. Rendered dimmed and marked. */
    present: boolean
    title: string
    /** The credit exactly as tagged; `null` when the file carries no artist tag. */
    artistText: string | null
    artistCredit: ArtistCreditSegment[]
    albumId: string | null
    /** *Release* in copy. */
    albumTitle: string | null
    genreText: string | null
    genres: CatalogEntityRef[]
    recordLabelId: string | null
    recordLabelText: string | null
    year: number | null
    bpm: number | null
    musicalKey: string | null
    /** Seconds. */
    duration: number | null
    /** Epoch milliseconds; `null` when the filesystem gave no creation time. */
    dateAdded: number | null
}

export type SongWindowResult = BrowseWindowResult<SongRow>

export interface QuerySongsRequest {
    query: SongQuery
    window: BrowseWindow
}

/**
 * Resolves the entity ids in a filter to display names, so the filter bar can show
 * removable chips. Deliberately separate from {@link QuerySongsRequest}: a filter
 * changes far less often than a viewport, and windows stay pure rows + total.
 */
export interface DescribeSongFilterRequest {
    filter: SongFilter
}

/**
 * The applied filter's entities, in the order their ids were given. Ids that no
 * longer resolve are dropped, so a stale URL degrades to a narrower chip set rather
 * than to an error.
 */
export interface SongFilterDescription {
    artists: CatalogEntityRef[]
    genres: CatalogEntityRef[]
    recordLabels: CatalogEntityRef[]
    albums: CatalogEntityRef[]
}

// ---------------------------------------------------------------------------
// Selection — ADR 0004
// ---------------------------------------------------------------------------

/** A half-open index range `[start, end)` within a query's ordering. */
export interface SelectionRange {
    start: number
    end: number
}

/**
 * A selection is **not a list of songs**. `Cmd-A` on a 500k library cannot mean an
 * array of 500k ids crossing IPC on every selection change, so a selection carries
 * the query it is relative to plus index ranges within that ordering — see ADR 0004
 * for the full case table and the rejected alternatives.
 *
 * Actions resolve this to rows in SQL, in the main process, where 500k rows is an
 * ordinary query. Nothing large ever crosses the boundary.
 */
export interface SongSelection {
    /** The filter + sort the {@link ranges} indices are meaningful against. */
    query: SongQuery
    ranges: SelectionRange[]
    /** Rows deselected inside {@link ranges}. */
    excluded: string[]
    /** Rows selected outside {@link ranges}. Immune to drift — an id means one song. */
    included: string[]
}

export const emptySongSelection = (query: SongQuery): SongSelection => ({
    query,
    ranges: [],
    excluded: [],
    included: [],
})
