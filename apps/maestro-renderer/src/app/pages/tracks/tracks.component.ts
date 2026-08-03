import { ChangeDetectionStrategy, Component, computed, inject, linkedSignal } from '@angular/core'
import { takeUntilDestroyed, toObservable, toSignal } from '@angular/core/rxjs-interop'
import { ActivatedRoute, Router } from '@angular/router'
import {
    SongPresence,
    type BrowseWindow,
    type SongFilter,
    type SongFilterDescription,
    type SongQuery,
    type SongSortField,
} from '@release-maestro/core'
import {
    auditTime,
    catchError,
    debounceTime,
    distinctUntilChanged,
    filter,
    from,
    map,
    merge,
    of,
    Subject,
    switchMap,
} from 'rxjs'
import { LibraryBrowseService } from '../../core/services/library-browse.service'
import { LibraryService } from '../../core/services/library.service'
import { createBrowseQuery } from '../../shared/browse/browse-query'
import { nextSort, songQueryFromParams, songQueryToParams } from '../../shared/browse/song-query-params'
import {
    emptySelection,
    sameQuery,
    selectionAfterRefetch,
    type SongSelectionState,
} from '../../shared/browse/song-selection'
import {
    BrowseShellComponent,
    type BrowseFilterChip,
    type BrowseFilterState,
    type BrowseShellState,
} from '../../shared/components/browse-shell/browse-shell.component'
import {
    SongTableComponent,
    type EntityFilterKind,
    type EntityFilterRequest,
} from '../../shared/components/song-table/song-table.component'

/**
 * The track list.
 *
 * Its whole job is wiring: the URL is the state, the browse query primitive turns it
 * into windows, and the shell and table render them. Everything reusable lives in
 * `shared/browse` and `shared/components` because slices 2–5 are the same page with
 * different rows.
 *
 * **The URL is the single source of truth for filter, sort and search.** Nothing is
 * mirrored into a component signal, so back and forward simply work, and there is no
 * second copy to drift.
 */

/** How often a running scan is allowed to refetch the visible window. */
const SCAN_REFETCH_INTERVAL_MS = 1_500

/** How long typing settles before a search reaches the URL and the read side. */
const SEARCH_DEBOUNCE_MS = 200

/** A guess, used only until the table has measured its own height. */
const INITIAL_WINDOW_LIMIT = 60

/** Availability rides in the same chip list as the entity filters, under its own kind. */
const PRESENCE_CHIP_KIND = 'presence'

const CHIP_KINDS: { kind: EntityFilterKind; kindLabel: string; field: keyof SongFilter }[] = [
    { kind: 'artist', kindLabel: 'Artist', field: 'artistIds' },
    { kind: 'genre', kindLabel: 'Genre', field: 'genreIds' },
    { kind: 'recordLabel', kindLabel: 'Label', field: 'recordLabelIds' },
    { kind: 'album', kindLabel: 'Release', field: 'albumIds' },
]

@Component({
    selector: 'app-tracks',
    templateUrl: './tracks.component.html',
    changeDetection: ChangeDetectionStrategy.OnPush,
    imports: [BrowseShellComponent, SongTableComponent],
    host: { class: 'flex min-h-0 min-w-0 flex-1 flex-col' },
})
export class TracksComponent {
    private route = inject(ActivatedRoute)
    private router = inject(Router)
    private browseService = inject(LibraryBrowseService)
    private libraryService = inject(LibraryService)

    private queryParams = toSignal(this.route.queryParams, { initialValue: {} })
    /**
     * Compared by value, so a navigation that rebuilds an identical query does not
     * read as a change — everything downstream keys off this identity.
     */
    protected query = computed<SongQuery>(() => songQueryFromParams(this.queryParams()), {
        equal: sameQuery,
    })

    /**
     * The slice the table wants. It goes back to the top whenever the query changes:
     * offset 5,000 means nothing in a result set the user has just filtered down, and
     * fetching it would only waste a round trip on rows nobody can see.
     */
    protected viewport = linkedSignal<SongQuery, BrowseWindow>({
        source: () => this.query(),
        computation: (_query, previous) => ({
            offset: 0,
            // Keep whatever the table measured; only the offset is stale.
            limit: previous?.value.limit ?? INITIAL_WINDOW_LIMIT,
        }),
    })

    private scanStatus$ = toObservable(this.libraryService.scanStatus)

    /**
     * Browse views refetch while a scan ingests songs.
     *
     * While it runs the status is audited rather than taken raw, because it ticks far
     * faster than a table needs to move, and rows shifting under the cursor is already
     * the accepted cost (ADR 0004).
     *
     * The end of a scan is a separate trigger, not just another tick. Auditing emits
     * the *last* value of each window, so whatever the scan commits after its final
     * progress event — the closing flush, and the normalization pass behind it — lands
     * with nothing left to announce it. Without this the table holds a stale count and
     * a stale window until the user happens to scroll or navigate.
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

    private browse = createBrowseQuery({
        query: this.query,
        viewport: this.viewport,
        sameQuery,
        refresh: this.scanProgress$,
        fetchWindow: (query, window) => this.browseService.querySongs(query, window),
    })

    protected result = this.browse.result

    /**
     * The applied filter resolved to names. Refetched only when the *filter* changes —
     * a chip's name has nothing to do with which window is on screen, so tying it to
     * the viewport would re-resolve it on every scroll tick.
     */
    private filterDescription = toSignal(
        toObservable(computed(() => this.query().filter)).pipe(
            switchMap(currentFilter =>
                hasEntityFilter(currentFilter)
                    ? from(this.browseService.describeSongFilter(currentFilter)).pipe(
                          // A rejection here must not take the page down with it.
                          // `toSignal` rethrows on read, so an unhandled error would
                          // make every computed that touches the description throw —
                          // `chips`, `filterState`, and with them the whole template.
                          // Falling back to unnamed costs the chips, not the table.
                          catchError(() => of(EMPTY_DESCRIPTION)),
                      )
                    : of(EMPTY_DESCRIPTION),
            ),
        ),
        { initialValue: EMPTY_DESCRIPTION },
    )

    private searchInput$ = new Subject<string>()

    constructor() {
        // A manual subscribe, because the result of this stream is a navigation rather
        // than state — there is no signal for it to land in. `takeUntilDestroyed` ends it.
        this.searchInput$
            .pipe(debounceTime(SEARCH_DEBOUNCE_MS), distinctUntilChanged(), takeUntilDestroyed())
            .subscribe(search => this.patchQuery({ ...this.query(), search }, { replaceUrl: true }))
    }

    /**
     * The selection, reset whenever the ground beneath it moves (ADR 0004): a filter,
     * sort or search change invalidates every index, and a refetch that changes the row
     * count re-points any range.
     *
     * A `linkedSignal` rather than a `signal` read through a reconciling `computed`,
     * because reconciling on read only *hides* a stale selection — the stored one is
     * still there, and it reappears the moment the query returns to what it was. This
     * resets the stored value, so a cleared selection stays cleared.
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

    protected shellState = computed<BrowseShellState>(() => {
        const result = this.result()
        return {
            entityLabel: 'tracks',
            entityLabelSingular: 'track',
            total: result.total,
            status: result.status,
            loaded: result.loaded,
            error: result.error,
        }
    })

    protected filterState = computed<BrowseFilterState>(() => ({
        search: this.query().search,
        chips: this.chips(),
        // Read from the query, not from the chips. When `describeSongFilter` fails
        // there are no chips to remove, but the filter is still in force — and
        // "Clear filters" is then the only way back out of it.
        hasFilter: hasAnyFilter(this.query().filter),
    }))

    protected chips = computed<BrowseFilterChip[]>(() => {
        const description = this.filterDescription()
        const entityChips = CHIP_KINDS.flatMap(({ kind, kindLabel }) =>
            entitiesFor(description, kind).map(entity => ({ ...entity, kind, kindLabel })),
        )

        // Availability is a chip like any other rather than a permanent control. It
        // only matters once something is actually missing, and the row badge is where
        // the user discovers it — see `SongTableComponent.filterMissing`.
        const presence = this.query().filter.presence
        if (presence == null || presence == SongPresence.any) return entityChips

        return [
            ...entityChips,
            {
                kind: PRESENCE_CHIP_KIND,
                kindLabel: 'Availability',
                id: presence,
                name: presence == SongPresence.missing ? 'Missing' : 'Available',
            },
        ]
    })

    protected onSort(field: SongSortField): void {
        this.patchQuery({ ...this.query(), sort: nextSort(this.query().sort, field) })
    }

    /**
     * Typing is debounced before it reaches the URL, so a search costs one query
     * rather than one per keystroke. The navigation replaces rather than pushes:
     * back should leave the search, not walk back through every letter of it.
     */
    protected onSearch(search: string): void {
        this.searchInput$.next(search)
    }

    /** The missing badge on a row is the only entry point to the availability filter. */
    protected onFilterMissing(): void {
        this.patchQuery({
            ...this.query(),
            filter: { ...this.query().filter, presence: SongPresence.missing },
        })
    }

    /**
     * A cell's entity link narrows the list to that entity.
     *
     * MAE-118 asks for each artist segment to link "to its artist", and the artist
     * detail page is MAE-120 — it does not exist yet. Filtering is the honest form of
     * that link today: it addresses the artist *entity*, works, and re-points to a
     * detail route in one place when slices 2–5 land.
     */
    protected onEntityFilter(request: EntityFilterRequest): void {
        const field = CHIP_KINDS.find(chipKind => chipKind.kind == request.kind)?.field
        if (!field) return

        const current = this.query().filter[field]
        const existing = Array.isArray(current) ? current : []
        if (existing.includes(request.id)) return

        this.patchQuery({
            ...this.query(),
            filter: { ...this.query().filter, [field]: [...existing, request.id] },
        })
    }

    protected onChipRemove(chip: BrowseFilterChip): void {
        if (chip.kind == PRESENCE_CHIP_KIND) {
            this.patchQuery({
                ...this.query(),
                filter: { ...this.query().filter, presence: SongPresence.any },
            })
            return
        }

        const field = CHIP_KINDS.find(chipKind => chipKind.kind == chip.kind)?.field
        if (!field) return

        const current = this.query().filter[field]
        const remaining = (Array.isArray(current) ? current : []).filter(id => id != chip.id)
        this.patchQuery({
            ...this.query(),
            filter: { ...this.query().filter, [field]: remaining },
        })
    }

    protected onClearFilters(): void {
        this.patchQuery({ ...this.query(), search: '', filter: {} })
    }

    protected onViewportChange(window: BrowseWindow): void {
        this.viewport.set(window)
    }

    protected onSelectionChange(selection: SongSelectionState): void {
        this.selection_.set(selection)
    }

    protected onRetry(): void {
        this.browse.retry()
    }

    private patchQuery(query: SongQuery, { replaceUrl = false }: { replaceUrl?: boolean } = {}): void {
        this.router.navigate([], {
            relativeTo: this.route,
            queryParams: songQueryToParams(query),
            queryParamsHandling: 'merge',
            replaceUrl,
        })
    }
}

const EMPTY_DESCRIPTION: SongFilterDescription = {
    artists: [],
    genres: [],
    recordLabels: [],
    albums: [],
}

const hasEntityFilter = (songFilter: SongFilter): boolean =>
    !!(
        songFilter.artistIds?.length ||
        songFilter.genreIds?.length ||
        songFilter.recordLabelIds?.length ||
        songFilter.albumIds?.length
    )

/** Any filter at all, entity or availability — what "Clear filters" undoes. */
const hasAnyFilter = (songFilter: SongFilter): boolean =>
    hasEntityFilter(songFilter) || (songFilter.presence != null && songFilter.presence != SongPresence.any)

const entitiesFor = (description: SongFilterDescription, kind: EntityFilterKind) => {
    switch (kind) {
        case 'artist':
            return description.artists
        case 'genre':
            return description.genres
        case 'recordLabel':
            return description.recordLabels
        case 'album':
            return description.albums
    }
}
