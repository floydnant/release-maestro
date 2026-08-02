import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core'
import { toObservable, toSignal } from '@angular/core/rxjs-interop'
import { ActivatedRoute, Router } from '@angular/router'
import {
    SongPresence,
    type BrowseWindow,
    type SongFilter,
    type SongFilterDescription,
    type SongQuery,
    type SongSortField,
} from '@release-maestro/core'
import { auditTime, filter, from, of, switchMap } from 'rxjs'
import { LibraryBrowseService } from '../../core/services/library-browse.service'
import { LibraryService } from '../../core/services/library.service'
import { createBrowseQuery } from '../../shared/browse/browse-query'
import { nextSort, songQueryFromParams, songQueryToParams } from '../../shared/browse/song-query-params'
import {
    emptySelection,
    sameQuery,
    selectionAfterRefetch,
    selectionForQuery,
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
    protected query = computed<SongQuery>(() => songQueryFromParams(this.queryParams()))

    protected viewport = signal<BrowseWindow>({ offset: 0, limit: 60 })

    /**
     * Browse views refetch while a scan ingests songs. It is audited rather than
     * taken raw because scan status ticks far faster than a table needs to move, and
     * rows shifting under the cursor is already the accepted cost (ADR 0004).
     */
    private scanProgress$ = toObservable(this.libraryService.scanStatus).pipe(
        filter(status => status?.phase == 'discovering' || status?.phase == 'reading'),
        auditTime(SCAN_REFETCH_INTERVAL_MS),
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
                    ? from(this.browseService.describeSongFilter(currentFilter))
                    : of(EMPTY_DESCRIPTION),
            ),
        ),
        { initialValue: EMPTY_DESCRIPTION },
    )

    private selection_ = signal<SongSelectionState>(emptySelection(songQueryFromParams({})))
    /**
     * The row count the stored selection was made against. Kept beside the selection
     * rather than inside it, because it is what a *drift check* compares — and it is
     * written in the same handler as the selection, so the two can never disagree.
     */
    private selectionTotal_ = signal(0)

    /**
     * The selection to render, reconciled with whatever moved underneath it (ADR 0004):
     * a filter or sort change invalidates every index, and a refetch that changes the
     * row count re-points any range. Both are pure derivations — no effect writes a
     * signal another effect reads.
     */
    protected selection = computed<SongSelectionState>(() =>
        selectionAfterRefetch(
            selectionForQuery(this.selection_(), this.query()),
            this.selectionTotal_(),
            this.result().total,
        ),
    )

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
        presence: this.query().filter.presence ?? SongPresence.any,
        chips: this.chips(),
    }))

    protected chips = computed<BrowseFilterChip[]>(() => {
        const description = this.filterDescription()
        return CHIP_KINDS.flatMap(({ kind, kindLabel }) =>
            entitiesFor(description, kind).map(entity => ({ ...entity, kind, kindLabel })),
        )
    })

    protected onSort(field: SongSortField): void {
        this.patchQuery({ ...this.query(), sort: nextSort(this.query().sort, field) })
    }

    protected onSearch(search: string): void {
        this.patchQuery({ ...this.query(), search })
    }

    protected onPresence(presence: SongPresence): void {
        this.patchQuery({
            ...this.query(),
            filter: { ...this.query().filter, presence },
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
        this.selectionTotal_.set(this.result().total)
    }

    protected onRetry(): void {
        this.browse.retry()
    }

    private patchQuery(query: SongQuery): void {
        this.router.navigate([], {
            relativeTo: this.route,
            queryParams: songQueryToParams(query),
            queryParamsHandling: 'merge',
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
