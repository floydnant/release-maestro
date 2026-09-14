import {
    ChangeDetectionStrategy,
    Component,
    computed,
    DestroyRef,
    inject,
    input,
    linkedSignal,
    untracked,
    viewChild,
} from '@angular/core'
import { toSignal } from '@angular/core/rxjs-interop'
import { ActivatedRoute, Router } from '@angular/router'
import { type BrowseWindow, type SongQuery, type SongSortField } from '@release-maestro/core'
import { HistoryService } from '../../core/services/history.service'
import { LibraryBrowseService } from '../../core/services/library-browse.service'
import { createBrowseQuery } from '../../shared/browse/browse-query'
import { libraryBrowseRefresh } from '../../shared/browse/library-browse-refresh'
import { nextSort, songQueryFromParams, songQueryToParams } from '../../shared/browse/song-query-params'
import {
    emptySelection,
    sameQuery,
    selectionAfterRefetch,
    type SongSelectionState,
} from '../../shared/browse/song-selection'
import {
    SongTableComponent,
    songWindowOffsetAt,
    type EntityFilterRequest,
} from '../../shared/components/song-table/song-table.component'

@Component({
    selector: 'app-genre-songs',
    templateUrl: './genre-songs.component.html',
    changeDetection: ChangeDetectionStrategy.OnPush,
    imports: [SongTableComponent],
    host: { class: 'flex min-h-0 min-w-0 flex-1 flex-col' },
})
export class GenreSongsComponent {
    genreId = input.required<string>()
    private route = inject(ActivatedRoute)
    private router = inject(Router)
    private service = inject(LibraryBrowseService)
    private history = inject(HistoryService)
    private table = viewChild(SongTableComponent)
    private params = toSignal(this.route.queryParams, { initialValue: {} })
    protected query = computed<SongQuery>(
        () => ({
            ...songQueryFromParams(this.params()),
            filter: { genreIds: [this.genreId()] },
        }),
        { equal: sameQuery },
    )
    protected restoreScrollTop = linkedSignal<SongQuery, number | null>({
        source: this.query,
        computation: () => untracked(() => this.history.scrollRestore()),
    })
    protected viewport = linkedSignal<SongQuery, BrowseWindow>({
        source: this.query,
        computation: (_query, previous) => ({
            offset: untracked(() => songWindowOffsetAt(this.restoreScrollTop() ?? 0)),
            limit: previous?.value.limit ?? 60,
        }),
    })
    private browse = createBrowseQuery({
        query: this.query,
        viewport: this.viewport,
        sameQuery,
        entityLabel: 'tracks',
        refresh: libraryBrowseRefresh(),
        fetchWindow: (query, window) => this.service.querySongs(query, window),
    })
    protected result = this.browse.result
    protected selection = linkedSignal<{ query: SongQuery; total: number }, SongSelectionState>({
        source: () => ({ query: this.query(), total: this.result().total }),
        computation: ({ query, total }, previous) =>
            !previous || !sameQuery(previous.source.query, query)
                ? emptySelection(query)
                : selectionAfterRefetch(previous.value, previous.source.total, total),
    })
    constructor() {
        const unregister = this.history.registerScrollProvider(() => this.table()?.scrollTop() ?? null)
        inject(DestroyRef).onDestroy(unregister)
    }
    protected onSort(field: SongSortField): void {
        const sort = nextSort(this.query().sort, field)
        this.router.navigate([], {
            relativeTo: this.route,
            queryParams: songQueryToParams({ ...this.query(), sort, filter: {} }),
            queryParamsHandling: 'merge',
            replaceUrl: true,
        })
    }
    protected onEntity(request: EntityFilterRequest): void {
        const param = { artist: 'artist', album: 'album', genre: 'genre', recordLabel: 'recordLabel' }[
            request.kind
        ]
        this.router.navigate(['/tracks'], { queryParams: { genre: this.genreId(), [param]: request.id } })
    }
    protected onMissing(): void {
        this.router.navigate(['/tracks'], { queryParams: { genre: this.genreId(), presence: 'missing' } })
    }
    protected onRetry(): void {
        this.browse.retry()
    }
    protected onScrollRestored(): void {
        this.restoreScrollTop.set(null)
        this.history.consumeScrollRestore()
    }
}
