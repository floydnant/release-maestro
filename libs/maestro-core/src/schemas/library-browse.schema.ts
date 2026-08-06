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
 * **album** in code and in copy alike.
 */

// ---------------------------------------------------------------------------
// Browse windowing — the shape shared by every browse surface
// ---------------------------------------------------------------------------

export const LibraryBrowseIpcChannel = {
    querySongs: 'library:query-songs',
    describeSongFilter: 'library:describe-song-filter',
    queryAlbums: 'library:query-albums',
    describeAlbumFilter: 'library:describe-album-filter',
    getAlbumDetail: 'library:get-album-detail',
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
    /** Sorts on the album title denormalized onto the song. */
    album: 'album',
    genre: 'genre',
    bpm: 'bpm',
    musicalKey: 'musicalKey',
    duration: 'duration',
    year: 'year',
    recordLabel: 'recordLabel',
    /** `songs.createdAt` (the file's creation time) stands in until MAE-116 lands a real `addedAt`. */
    dateAdded: 'dateAdded',
    /**
     * A song's position on its album. The one sort no column header offers, because it
     * only orders a list that is already one album — the album detail page (MAE-119).
     * Sorting a whole library by it would interleave every record's track 1.
     *
     * A multi-disc album orders `1,1,2,2,3,3…` and cannot do better: there is no disc
     * number anywhere in the system until MAE-123 lands one.
     */
    trackNumber: 'trackNumber',
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
    /**
     * Record labels reach songs through their album — `songs` carries no record
     * label of its own beyond the denormalized tag text.
     */
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
    /**
     * Absolute filesystem path to cached cover art, rendered through a `file://` URL.
     * The song's own artwork when it has any, otherwise its album's — a track tagged
     * without embedded art still belongs to an album that has some.
     */
    coverPath: string | null
    /** The credit exactly as tagged; `null` when the file carries no artist tag. */
    artistText: string | null
    artistCredit: ArtistCreditSegment[]
    albumId: string | null
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
// AlbumQuery — filter + sort + search
// ---------------------------------------------------------------------------

/**
 * Sortable album columns, each backed by an index on `albums` (see the
 * `mae-119-album-browse-sort-indexes` migration).
 *
 * Three of these are columns only because sorting needs them to be.
 * `recordLabel`, `trackCount` and `dateAdded` read naturally as a join and two
 * aggregates, and all three are denormalized onto `albums` instead — an
 * `ORDER BY (SELECT COUNT(*) …)` has to count every album in the library before it
 * can serve the first window, which is the one thing ADR 0004 exists to prevent. The
 * write side maintains them; see `LibraryBackendRepository`.
 */
export const AlbumSortField = {
    title: 'title',
    albumArtist: 'albumArtist',
    year: 'year',
    recordLabel: 'recordLabel',
    trackCount: 'trackCount',
    /**
     * When the album arrived, taken as the newest {@link SongSortField.dateAdded} across
     * its songs — a record is as new as the most recent file on it, so ripping the rest
     * of a part-ripped album brings the whole record back to the top rather than leaving
     * it where its oldest track put it.
     *
     * Named to match the song sort, and standing on the same footing: `songs.createdAt`
     * until MAE-116 lands a real `addedAt`. An album whose files carry no creation time
     * at all is `null`, which SQLite orders below every date — so it sits at the bottom
     * under the newest-first default, which is where an unknown date belongs.
     */
    dateAdded: 'dateAdded',
} as const

export type AlbumSortField = (typeof AlbumSortField)[keyof typeof AlbumSortField]

export interface AlbumSort {
    field: AlbumSortField
    direction: SortDirection
}

/**
 * Filters address **entities**, never text — the same rule as {@link SongFilter}.
 * `albumArtistIds` matches through `album_artists`, so filtering by an artist finds
 * the albums they are credited on rather than the ones whose `artistText` happens to
 * contain their name.
 *
 * There is deliberately **no presence filter**. `albums` has no `present` column, and
 * the honest album-level equivalent — "every song on this record is missing" — is a
 * derived property that would cost an aggregate per row on every window. An album with
 * missing tracks still shows in the grid; the missing tracks are marked on its detail
 * page, which is where the user can act on them.
 */
export interface AlbumFilter {
    albumArtistIds?: string[]
    recordLabelIds?: string[]
    genreIds?: string[]
}

/** A filter + sort + search, and the unit the albums grid passes around. */
export interface AlbumQuery {
    filter: AlbumFilter
    sort: AlbumSort
    /**
     * Free-text search across album title, album artist and record label. Goes through
     * the same single seam as {@link SongQuery.search} — `LIKE '%…%'` today, one file
     * to swap for FTS5.
     */
    search: string
}

/**
 * Newest first, matching the track list's own default: opening either surface should
 * show what the user just added rather than whatever happens to start with "A".
 */
export const DEFAULT_ALBUM_SORT: AlbumSort = { field: AlbumSortField.dateAdded, direction: 'desc' }

export const emptyAlbumQuery = (): AlbumQuery => ({
    filter: {},
    sort: { ...DEFAULT_ALBUM_SORT },
    search: '',
})

/**
 * One tile in the albums grid.
 *
 * **Expect visible duplicates.** `albumIdentityKey` hashes albumArtist, catalogNumber,
 * date, record label, title and year, so one file with a missing `label` tag — or
 * `2019-03` where its siblings say `2019-03-01` — becomes a second album. A real
 * collection shows some records two or three times. That is a normalization problem
 * (MAE-97), not a browsing one: nothing here merges rows at display time, because a
 * heuristic that guesses which tiles are "really" one album would hide the very
 * evidence MAE-97 needs.
 */
export interface AlbumRow {
    id: string
    title: string
    /** Absolute filesystem path to cached cover art, rendered through a `file://` URL. */
    coverPath: string | null
    /** The album artist exactly as tagged; `null` when the files carry no album artist. */
    albumArtistText: string | null
    /**
     * The album artists as entities, in credited order. Unlike a song's artist credit
     * this is a plain list rather than reconstructable segments — an album's artist
     * text is one tag on a group of files, not a credit line to be printed verbatim.
     */
    albumArtists: CatalogEntityRef[]
    year: number | null
    recordLabelId: string | null
    recordLabelText: string | null
    /** Songs in the library belonging to this album, missing ones included. */
    trackCount: number
}

export type AlbumWindowResult = BrowseWindowResult<AlbumRow>

export interface QueryAlbumsRequest {
    query: AlbumQuery
    window: BrowseWindow
}

export interface DescribeAlbumFilterRequest {
    filter: AlbumFilter
}

export interface AlbumFilterDescription {
    albumArtists: CatalogEntityRef[]
    recordLabels: CatalogEntityRef[]
    genres: CatalogEntityRef[]
}

// ---------------------------------------------------------------------------
// Album detail
// ---------------------------------------------------------------------------

export interface GetAlbumDetailRequest {
    albumId: string
}

/**
 * One album's own attributes, everything the detail header shows.
 *
 * The tracks are **not** here: they are a windowed {@link SongQuery} like any other
 * list, filtered to this album and sorted by {@link SongSortField.trackNumber}. A
 * detail page that shipped its tracks inline would be the one browse surface that
 * loads a whole result set, and a 200-track compilation is exactly where that stops
 * being free.
 */
export interface AlbumDetail {
    id: string
    title: string
    coverPath: string | null
    albumArtistText: string | null
    albumArtists: CatalogEntityRef[]
    year: number | null
    /** The full release date as tagged, when there was one — `2019-03-01`, or `2019-03`. */
    date: string | null
    catalogNumber: string | null
    recordLabelId: string | null
    recordLabelText: string | null
    trackCount: number
    /** Summed song durations in seconds; `null` when no song on the album has one. */
    totalDuration: number | null
    /** Distinct genres across the album's songs, for the header's genre line. */
    genres: CatalogEntityRef[]
}

/** `null` when the id resolves to nothing — a stale link, or an album a rescan re-keyed. */
export type AlbumDetailResult = AlbumDetail | null

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
