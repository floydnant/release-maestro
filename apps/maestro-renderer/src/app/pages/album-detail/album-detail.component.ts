import {
    ChangeDetectionStrategy,
    Component,
    computed,
    DestroyRef,
    inject,
    linkedSignal,
    untracked,
    viewChild,
} from '@angular/core'
import { toObservable, toSignal } from '@angular/core/rxjs-interop'
import { ActivatedRoute, Router, RouterLink } from '@angular/router'
import {
    SongSortField,
    emptySongQuery,
    type AlbumDetail,
    type BrowseWindow,
    type SongQuery,
    type SongSort,
} from '@release-maestro/core'
import {
    auditTime,
    catchError,
    distinctUntilChanged,
    filter,
    from,
    map,
    merge,
    of,
    startWith,
    switchMap,
} from 'rxjs'
import { HistoryService } from '../../core/services/history.service'
import { LibraryBrowseService } from '../../core/services/library-browse.service'
import { LibraryService } from '../../core/services/library.service'
import { createBrowseQuery } from '../../shared/browse/browse-query'
import { listWindowOffsetAt } from '../../shared/browse/list-window'
import { SongQueryParam, nextSort, songSortFromParams } from '../../shared/browse/song-query-params'
import {
    emptySelection,
    sameQuery,
    selectionAfterRefetch,
    type SongSelectionState,
} from '../../shared/browse/song-selection'
import { IconComponent } from '../../shared/components/icon/icon.component'
import {
    SongTableComponent,
    type SongTableColumn,
    type SongTableGroup,
} from '../../shared/components/song-table/song-table.component'
import { AlbumDetailHeaderComponent } from './album-detail-header.component'

/**
 * One album: its own attributes, and its tracks.
 *
 * **The tracks are an ordinary browse surface**, not an inline list — a windowed
 * `SongQuery` filtered to this album and sorted by disc then track number, rendered by the same
 * `SongTable` the track list uses. A detail page that loaded its tracks whole would be
 * the one surface that ignores ADR 0004, and a 200-track compilation is exactly where
 * that stops being free.
 *
 * Disc sections use boundaries from the album detail aggregate, so a window can start
 * in the middle of a disc without creating a false section heading.
 */

/** How often a running scan is allowed to refetch the visible window. */
const SCAN_REFETCH_INTERVAL_MS = 1_500

/** A guess, used only until the table has measured its own height. */
const INITIAL_WINDOW_LIMIT = 60

const TRACKS_LABEL = 'tracks'
const TRACK_LABEL = 'track'

/** Album is one word in code and in copy alike, so the route param is `albumId`. */
export const ALBUM_ID_PARAM = 'albumId'

/**
 * Album order, and what the URL means by carrying no sort at all.
 *
 * The read model orders by disc number before track number for this sort.
 */
const DEFAULT_TRACK_SORT: SongSort = { field: SongSortField.trackNumber, direction: 'asc' }

type DetailStatus = 'loading' | 'ready' | 'missing' | 'error'

interface DetailState {
    status: DetailStatus
    album: AlbumDetail | null
}

const LOADING_STATE: DetailState = { status: 'loading', album: null }

@Component({
    selector: 'app-album-detail',
    templateUrl: './album-detail.component.html',
    changeDetection: ChangeDetectionStrategy.OnPush,
    imports: [AlbumDetailHeaderComponent, IconComponent, RouterLink, SongTableComponent],
    host: { class: 'flex min-h-0 min-w-0 flex-1 flex-col' },
})
export class AlbumDetailComponent {
    private route = inject(ActivatedRoute)
    private router = inject(Router)
    private browseService = inject(LibraryBrowseService)
    private libraryService = inject(LibraryService)
    private history = inject(HistoryService)

    private table = viewChild(SongTableComponent)

    private albumId = toSignal(this.route.paramMap.pipe(map(params => params.get(ALBUM_ID_PARAM) ?? '')), {
        initialValue: '',
    })

    private scanStatus$ = toObservable(this.libraryService.scanStatus)

    /**
     * Refetch triggers, shared by the header and the track table. Audited while a scan
     * runs, plus the end of one — the same pair, and the same reasoning, as the track
     * list's; see `TracksComponent.scanProgress$`.
     */
    private scanProgress$ = merge(
        this.scanStatus$.pipe(
            filter(status => status?.phase == 'discovering' || status?.phase == 'reading'),
            auditTime(SCAN_REFETCH_INTERVAL_MS),
        ),
        this.scanStatus$.pipe(
            map(status => status?.phase),
            distinctUntilChanged(),
            filter(phase => phase == 'completed' || phase == 'cancelled' || phase == 'failed'),
        ),
    )

    /**
     * The album's own attributes.
     *
     * `switchMap` because navigating between albums supersedes: the answer for the album
     * you have left is worthless, and a slow one must not land over a fast newer one.
     *
     * The refetch is what keeps the header's track count and duration in step with the
     * table beneath it while a scan ingests the rest of the record — the two would
     * otherwise disagree on screen, which reads as a bug rather than as progress.
     */
    protected detail = toSignal(
        toObservable(this.albumId).pipe(
            switchMap(albumId =>
                this.scanProgress$.pipe(
                    startWith(null),
                    switchMap(() =>
                        from(this.browseService.getAlbumDetail(albumId)).pipe(
                            map((album): DetailState =>
                                album ? { status: 'ready', album } : { status: 'missing', album: null },
                            ),
                            // A rejection is the library failing to answer, which is not
                            // the same as an album that is gone — the copy differs and so
                            // does what the user can do next.
                            catchError(() => of<DetailState>({ status: 'error', album: null })),
                        ),
                    ),
                    // Blank the header only when the *album* changes, not on a refetch of
                    // the one already on screen.
                    startWith(LOADING_STATE),
                ),
            ),
        ),
        { initialValue: LOADING_STATE },
    )

    protected album = computed(() => this.detail().album)
    protected status = computed(() => this.detail().status)

    /**
     * The track order, `trackNumber` unless the user has clicked a column.
     *
     * In the URL like every other browse sort, so back and forward work and a link
     * carries the order it was shared in. `trackNumber` is the *default* rather than the
     * only option because `SongTable`'s headings are buttons: leaving them unwired would
     * put ten controls on the page that visibly do nothing.
     */
    protected sort = toSignal(
        this.route.queryParams.pipe(map(params => songSortFromParams(params, DEFAULT_TRACK_SORT))),
        { initialValue: DEFAULT_TRACK_SORT },
    )

    /**
     * The album's tracks.
     *
     * A plain `SongQuery`, which is what makes this the same table as `/tracks` rather
     * than a bespoke one: the filter names the album entity, and the sort is whatever the
     * URL says.
     */
    protected query = computed<SongQuery>(
        () => ({
            ...emptySongQuery(),
            filter: { albumIds: [this.albumId()] },
            sort: this.sort(),
        }),
        { equal: sameQuery },
    )

    /**
     * The scroll position this arrival is meant to land at, latched per query — see
     * `TracksComponent.restoreScrollTop`, which carries the reasoning. It matters most
     * here: moving between two albums reuses this component, so construction is not the
     * event a latch can key on.
     */
    protected restoreScrollTop = linkedSignal<SongQuery, number | null>({
        source: () => this.query(),
        computation: () => untracked(() => this.history.scrollRestore()),
    })

    /**
     * The slice the table wants, seeded from that position so the first window fetched
     * is the right one — see `TracksComponent.viewport`.
     */
    private orderedDiscGroups = computed(() => {
        if (this.sort().field != SongSortField.trackNumber) return []
        const album = this.album()
        if (!album) return []
        const ordered = this.sort().direction == 'desc' ? [...album.discGroups].reverse() : album.discGroups
        let startIndex = 0
        return ordered.map(group => {
            const section = {
                discNumber: group.discNumber,
                startIndex: startIndex,
                label: group.discNumber == null ? 'Disc unknown' : `Disc ${group.discNumber}`,
                summary: `${group.songCount}${group.trackTotal != null && group.trackTotal != group.songCount ? `/${group.trackTotal}` : ''} ${group.songCount == 1 && (group.trackTotal == null || group.trackTotal == group.songCount) ? 'track' : 'tracks'}`,
            }
            startIndex += group.songCount
            return section
        })
    })

    private viewportSource = computed(
        () => ({
            query: this.query(),
            groupStarts: this.orderedDiscGroups().map(group => group.startIndex),
        }),
        {
            equal: (a, b) =>
                sameQuery(a.query, b.query) &&
                a.groupStarts.length == b.groupStarts.length &&
                a.groupStarts.every((start, index) => start == b.groupStarts[index]),
        },
    )

    protected viewport = linkedSignal<{ query: SongQuery; groupStarts: number[] }, BrowseWindow>({
        source: () => this.viewportSource(),
        computation: ({ query, groupStarts }, previous) => {
            const restore = untracked(() => this.restoreScrollTop())
            if (previous && sameQuery(previous.source.query, query) && restore == null) return previous.value
            return {
                offset: offsetForRestore(restore, groupStarts),
                limit: previous?.value.limit ?? INITIAL_WINDOW_LIMIT,
            }
        },
    })

    constructor() {
        // Where the table is scrolled to, so that leaving this album records it against
        // the history entry being left.
        const unregister = this.history.registerScrollProvider(() => this.table()?.scrollTop() ?? null)
        inject(DestroyRef).onDestroy(unregister)
    }

    private browse = createBrowseQuery({
        query: this.query,
        viewport: this.viewport,
        sameQuery,
        entityLabel: TRACKS_LABEL,
        refresh: this.scanProgress$,
        fetchWindow: (query, window) => this.browseService.querySongs(query, window),
    })

    protected result = this.browse.result

    /**
     * Whether the retained browse window can be shown beneath the current album header.
     *
     * `createBrowseQuery` deliberately keeps the previous rows while a new query loads.
     * That is useful for a sort, scroll or scan refresh within one album, but same-route
     * navigation changes the album id while reusing this component. Non-empty rows carry
     * the identity needed to distinguish those cases. A retained empty result is current
     * only when the live detail count also says this album is empty.
     */
    protected songWindowMatchesAlbum = computed(() => {
        const album = this.album()
        if (!album) return false

        const result = this.result()
        if (result.rows.some(song => song.albumId != album.id)) return false
        if (result.status == 'ready') return true

        return result.loaded && (result.rows.length > 0 || (result.total == 0 && album.songCount == 0))
    })

    /** Never let a retained window from the previous route supply the new header's count. */
    protected headerSongCount = computed(() =>
        this.songWindowMatchesAlbum() ? this.result().total : (this.album()?.songCount ?? 0),
    )

    protected songCountLabel = computed(() => (this.headerSongCount() == 1 ? TRACK_LABEL : TRACKS_LABEL))

    protected discGroups = computed<readonly SongTableGroup[]>(() => {
        const album = this.album()
        if (!album) return []
        const groups = this.orderedDiscGroups()
        const result = this.result()
        if (result.rows.some(song => song.albumId != album.id)) return []
        return groups.every((group, position) =>
            result.rows.every((song, rowIndex) => {
                const index = result.offset + rowIndex
                const nextStart = groups[position + 1]?.startIndex ?? Number.POSITIVE_INFINITY
                return index < group.startIndex || index >= nextStart || song.discNumber == group.discNumber
            }),
        )
            ? groups
            : []
    })

    /**
     * This page's columns, which differ from the default in both directions.
     *
     * **The track number is in**, first, because this is the one list where it means
     * something: every row is the same record, so the numbers are that record's running
     * order rather than a column of unrelated positions.
     *
     * **The album is out.** The query is filtered to one album and the header above the
     * table names it, so the column would be the same title repeated down every row —
     * 208px of width saying what the page already said. Its sort heading goes with it,
     * which is no loss: sorting one album's tracks by album title orders nothing.
     *
     * A field rather than a literal in the template, so the binding is one stable
     * reference instead of a new array on every change detection pass.
     */
    protected readonly columns: readonly SongTableColumn[] = [
        'trackNumber',
        'cover',
        'title',
        'artist',
        'genre',
        'bpm',
        'musicalKey',
        'duration',
        'year',
        'recordLabel',
        'dateAdded',
    ]

    /**
     * Selection, on the same ADR 0004 rules as the track list: a refetch that change
     * the row count re-points any range, so a ranged selection clears and an id-only one
     * survives. The sort here is fixed, so only the refetch case can ever fire.
     */
    private selection_ = linkedSignal<{ query: SongQuery; total: number }, SongSelectionState>({
        source: () => ({ query: this.query(), total: this.result().total }),
        computation: ({ query, total }, previous) => {
            if (!previous) return emptySelection(query)
            if (!sameQuery(previous.source.query, query)) return emptySelection(query)
            return selectionAfterRefetch(previous.value, previous.source.total, total)
        },
    })

    protected selection = this.selection_.asReadonly()

    protected onFilterMissing(): void {
        this.router.navigate(['/tracks'], {
            queryParams: { album: this.albumId(), presence: 'missing' },
        })
    }

    /**
     * A column click re-sorts the album's tracks.
     *
     * Returning to `trackNumber` is a plain navigation to the route without the params,
     * which `nextSort` reaches by cycling the column — nothing extra is needed to get
     * back to album order beyond clicking the default column.
     *
     * It replaces the history entry rather than pushing one: a sort is not a page, and
     * Back from here belongs to whatever brought the user to this album. See ADR 0006.
     */
    protected onSort(field: SongSortField): void {
        const next = nextSort(this.sort(), field)
        this.router.navigate([], {
            relativeTo: this.route,
            queryParams: {
                [SongQueryParam.sort]: next.field == DEFAULT_TRACK_SORT.field ? null : next.field,
                [SongQueryParam.direction]:
                    next.field == DEFAULT_TRACK_SORT.field && next.direction == DEFAULT_TRACK_SORT.direction
                        ? null
                        : next.direction,
            },
            queryParamsHandling: 'merge',
            replaceUrl: true,
        })
    }

    protected onSelectionChange(selection: SongSelectionState): void {
        this.selection_.set(selection)
    }

    protected onViewportChange(window: BrowseWindow): void {
        this.viewport.set(window)
    }

    protected onRetry(): void {
        this.browse.retry()
    }

    /** The table has put the position back; nothing should offer it again. */
    protected onScrollRestored(): void {
        this.restoreScrollTop.set(null)
        this.history.consumeScrollRestore()
    }
}

/** Where a window has to start for a remembered scroll position to be inside it. */
const offsetForRestore = (scrollTop: number | null, groupStarts: readonly number[]): number =>
    scrollTop == null ? 0 : listWindowOffsetAt(scrollTop, groupStarts)
