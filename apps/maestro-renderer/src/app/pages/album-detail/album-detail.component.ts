import { ChangeDetectionStrategy, Component, computed, inject, linkedSignal } from '@angular/core'
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
import { LibraryBrowseService } from '../../core/services/library-browse.service'
import { LibraryService } from '../../core/services/library.service'
import { createBrowseQuery } from '../../shared/browse/browse-query'
import { nextSort, songSortFromParams, SongQueryParam } from '../../shared/browse/song-query-params'
import {
    emptySelection,
    sameQuery,
    selectionAfterRefetch,
    type SongSelectionState,
} from '../../shared/browse/song-selection'
import { IconComponent } from '../../shared/components/icon/icon.component'
import {
    SongTableComponent,
    type EntityFilterRequest,
} from '../../shared/components/song-table/song-table.component'
import { AlbumDetailHeaderComponent } from './album-detail-header.component'

/**
 * One album: its own attributes, and its tracks.
 *
 * **The tracks are an ordinary browse surface**, not an inline list — a windowed
 * `SongQuery` filtered to this album and sorted by `trackNumber`, rendered by the same
 * `SongTable` the track list uses. A detail page that loaded its tracks whole would be
 * the one surface that ignores ADR 0004, and a 200-track compilation is exactly where
 * that stops being free.
 *
 * **Track order is `trackNumber` and cannot be better than that yet.** There is no disc
 * number anywhere in the system (MAE-123), so a multi-disc album renders `1, 1, 2, 2, 3,
 * 3…`. That is accepted rather than worked around: every workaround available here —
 * inferring discs from a gap in the numbering, from the file path, from the tag order —
 * guesses, and a guess that is usually right is worse than an ordering that is honestly
 * limited.
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
 * A multi-disc album renders `1, 1, 2, 2, 3, 3…` under this and cannot do better —
 * there is no disc number anywhere in the system until MAE-123 lands one.
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

    protected viewport = linkedSignal<SongQuery, BrowseWindow>({
        source: () => this.query(),
        computation: (_query, previous) => ({
            offset: 0,
            limit: previous?.value.limit ?? INITIAL_WINDOW_LIMIT,
        }),
    })

    private browse = createBrowseQuery({
        query: this.query,
        viewport: this.viewport,
        sameQuery,
        entityLabel: TRACKS_LABEL,
        refresh: this.scanProgress$,
        fetchWindow: (query, window) => this.browseService.querySongs(query, window),
    })

    protected result = this.browse.result

    protected trackCountLabel = computed(() => (this.result().total == 1 ? TRACK_LABEL : TRACKS_LABEL))

    /**
     * Selection, on the same ADR 0004 rules as the track list: a refetch that changes
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

    /**
     * An entity link in a track row narrows the *track list* to that entity.
     *
     * Neither the artist page (MAE-120) nor the record label page exists yet, so a link
     * that claims to address an artist has to resolve to the one surface that can show
     * them: `/tracks` filtered to that entity. It addresses the right entity, it works,
     * and it becomes a `routerLink` in one place when those slices land — which is
     * exactly what happened to the album link once this page existed.
     *
     * The album kind is deliberately not handled: every row here is this album, so the
     * link would navigate to the page it is already on.
     */
    protected onEntityFilter(request: EntityFilterRequest): void {
        const param = TRACK_FILTER_PARAMS[request.kind]
        if (!param) return

        this.router.navigate(['/tracks'], { queryParams: { [param]: request.id } })
    }

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
     * back to album order beyond clicking the default column, or going back.
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
}

/**
 * Which track-list query param addresses each entity kind. `album` is absent on purpose
 * — see {@link AlbumDetailComponent.onEntityFilter}.
 */
const TRACK_FILTER_PARAMS: Partial<Record<EntityFilterRequest['kind'], string>> = {
    artist: 'artist',
    genre: 'genre',
    recordLabel: 'recordLabel',
}
