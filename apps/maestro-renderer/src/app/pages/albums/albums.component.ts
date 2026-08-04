import { ChangeDetectionStrategy, Component, computed, inject, linkedSignal } from '@angular/core'
import { takeUntilDestroyed, toObservable, toSignal } from '@angular/core/rxjs-interop'
import { ActivatedRoute, Router } from '@angular/router'
import type {
    AlbumFilter,
    AlbumFilterDescription,
    AlbumQuery,
    AlbumSortField,
    BrowseWindow,
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
import {
    albumQueryFromParams,
    albumQueryToParams,
    nextAlbumSort,
    sameAlbumFilter,
    sameAlbumQuery,
} from '../../shared/browse/album-query-params'
import { createBrowseQuery } from '../../shared/browse/browse-query'
import {
    BrowseShellComponent,
    type BrowseFilterChip,
    type BrowseFilterState,
    type BrowseShellState,
} from '../../shared/components/browse-shell/browse-shell.component'
import { AlbumGridComponent } from './album-grid.component'
import { AlbumSortBarComponent } from './album-sort-bar.component'

/**
 * The albums grid.
 *
 * Wiring, like the track list: the URL is the state, the browse query primitive turns it
 * into windows, and the shell and grid render them. It is deliberately the same shape as
 * `TracksComponent` — the same shell, the same primitive, the same URL-is-the-truth rule
 * — because slices 2–5 differ in their rows and in nothing else.
 *
 * **The URL is the single source of truth for filter, sort and search.** Nothing is
 * mirrored into a component signal, so back and forward simply work.
 */

/** How often a running scan is allowed to refetch the visible window. */
const SCAN_REFETCH_INTERVAL_MS = 1_500

/** How long typing settles before a search reaches the URL and the read side. */
const SEARCH_DEBOUNCE_MS = 200

/** A guess, used only until the grid has measured its own geometry. */
const INITIAL_WINDOW_LIMIT = 60

/** Album is one word in code and in copy alike — see the glossary. */
const ALBUMS_LABEL = 'albums'
const ALBUM_LABEL = 'album'

type AlbumChipKind = 'albumArtist' | 'recordLabel' | 'genre'

const CHIP_KINDS: { kind: AlbumChipKind; kindLabel: string; field: keyof AlbumFilter }[] = [
    { kind: 'albumArtist', kindLabel: 'Album artist', field: 'albumArtistIds' },
    { kind: 'recordLabel', kindLabel: 'Record label', field: 'recordLabelIds' },
    { kind: 'genre', kindLabel: 'Genre', field: 'genreIds' },
]

@Component({
    selector: 'app-albums',
    templateUrl: './albums.component.html',
    changeDetection: ChangeDetectionStrategy.OnPush,
    imports: [AlbumGridComponent, AlbumSortBarComponent, BrowseShellComponent],
    host: { class: 'flex min-h-0 min-w-0 flex-1 flex-col' },
})
export class AlbumsComponent {
    private route = inject(ActivatedRoute)
    private router = inject(Router)
    private browseService = inject(LibraryBrowseService)
    private libraryService = inject(LibraryService)

    private queryParams = toSignal(this.route.queryParams, { initialValue: {} })
    /** Compared by value, so a navigation that rebuilds an identical query is not a change. */
    protected query = computed<AlbumQuery>(() => albumQueryFromParams(this.queryParams()), {
        equal: sameAlbumQuery,
    })

    /**
     * The slice the grid wants. It goes back to the top whenever the query changes:
     * offset 5,000 means nothing in a result set the user has just filtered down.
     */
    protected viewport = linkedSignal<AlbumQuery, BrowseWindow>({
        source: () => this.query(),
        computation: (_query, previous) => ({
            offset: 0,
            // Keep whatever the grid measured; only the offset is stale.
            limit: previous?.value.limit ?? INITIAL_WINDOW_LIMIT,
        }),
    })

    private scanStatus$ = toObservable(this.libraryService.scanStatus)

    /**
     * Browse views refetch while a scan ingests songs. Audited while it runs, because the
     * status ticks far faster than a grid needs to move, plus a separate trigger on the
     * end of a scan — auditing emits the last value of each window, so whatever the scan
     * commits after its final progress event would otherwise land with nothing to
     * announce it. See `TracksComponent`, which has the same pair for the same reason.
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
        sameQuery: sameAlbumQuery,
        entityLabel: ALBUMS_LABEL,
        refresh: this.scanProgress$,
        fetchWindow: (query, window) => this.browseService.queryAlbums(query, window),
    })

    protected result = this.browse.result

    /**
     * The applied filter resolved to names, refetched only when the *filter* changes — a
     * chip's name has nothing to do with which window is on screen.
     */
    private filterDescription = toSignal(
        toObservable(computed(() => this.query().filter, { equal: sameAlbumFilter })).pipe(
            switchMap(currentFilter =>
                hasEntityFilter(currentFilter)
                    ? from(this.browseService.describeAlbumFilter(currentFilter)).pipe(
                          // `toSignal` rethrows on read, so an unhandled rejection here
                          // would make every computed that touches the description throw
                          // and take the page with it. Falling back to unnamed costs the
                          // chips, not the grid.
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
            .pipe(
                debounceTime(SEARCH_DEBOUNCE_MS),
                // Compare with the URL-derived source of truth, not the Subject's last
                // emission: another action can clear the search without touching this stream.
                filter(search => search != this.query().search),
                takeUntilDestroyed(),
            )
            .subscribe(search => this.patchQuery({ ...this.query(), search }, { replaceUrl: true }))
    }

    protected shellState = computed<BrowseShellState>(() => {
        const result = this.result()
        return {
            entityLabel: ALBUMS_LABEL,
            entityLabelSingular: ALBUM_LABEL,
            total: result.total,
            status: result.status,
            loaded: result.loaded,
            error: result.error,
        }
    })

    protected filterState = computed<BrowseFilterState>(() => ({
        search: this.query().search,
        chips: this.chips(),
        // Read from the query, not from the chips. When `describeAlbumFilter` fails there
        // are no chips to remove, but the filter is still in force — and "Clear filters"
        // is then the only way back out of it.
        hasFilter: hasEntityFilter(this.query().filter),
    }))

    protected chips = computed<BrowseFilterChip[]>(() =>
        CHIP_KINDS.flatMap(({ kind, kindLabel }) =>
            entitiesFor(this.filterDescription(), kind).map(entity => ({ ...entity, kind, kindLabel })),
        ),
    )

    protected onSortField(field: AlbumSortField): void {
        this.patchQuery({ ...this.query(), sort: nextAlbumSort(this.query().sort, field) })
    }

    /**
     * Flip the direction of the current sort.
     *
     * `nextAlbumSort` with the field already in force is exactly that — it flips rather
     * than re-deriving a natural direction — so the toggle and a repeat click on the same
     * column go through one rule.
     */
    protected onDirectionToggle(): void {
        this.patchQuery({
            ...this.query(),
            sort: nextAlbumSort(this.query().sort, this.query().sort.field),
        })
    }

    /**
     * Typing is debounced before it reaches the URL, so a search costs one query rather
     * than one per keystroke. The navigation replaces rather than pushes: back should
     * leave the search, not walk back through every letter of it.
     */
    protected onSearch(search: string): void {
        this.searchInput$.next(search)
    }

    protected onChipRemove(chip: BrowseFilterChip): void {
        const field = CHIP_KINDS.find(chipKind => chipKind.kind == chip.kind)?.field
        if (!field) return

        const remaining = (this.query().filter[field] ?? []).filter(id => id != chip.id)
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

    protected onRetry(): void {
        this.browse.retry()
    }

    private patchQuery(query: AlbumQuery, { replaceUrl = false }: { replaceUrl?: boolean } = {}): void {
        this.router.navigate([], {
            relativeTo: this.route,
            queryParams: albumQueryToParams(query),
            queryParamsHandling: 'merge',
            replaceUrl,
        })
    }
}

const EMPTY_DESCRIPTION: AlbumFilterDescription = {
    albumArtists: [],
    recordLabels: [],
    genres: [],
}

const hasEntityFilter = (albumFilter: AlbumFilter): boolean =>
    !!(
        albumFilter.albumArtistIds?.length ||
        albumFilter.recordLabelIds?.length ||
        albumFilter.genreIds?.length
    )

const entitiesFor = (description: AlbumFilterDescription, kind: AlbumChipKind) => {
    switch (kind) {
        case 'albumArtist':
            return description.albumArtists
        case 'recordLabel':
            return description.recordLabels
        case 'genre':
            return description.genres
    }
}
