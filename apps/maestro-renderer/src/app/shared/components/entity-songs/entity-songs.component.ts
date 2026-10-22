import { HlmButton } from '@spartan-ng/helm/button'
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
import { type BrowseWindow, type SongFilter, type SongQuery, type SongSortField } from '@release-maestro/core'
import { HistoryService } from '../../../core/services/history.service'
import { LibraryBrowseService } from '../../../core/services/library-browse.service'
import { createBrowseQuery } from '../../browse/browse-query'
import { listWindowOffsetAt } from '../../browse/list-window'
import { libraryBrowseRefresh } from '../../browse/library-browse-refresh'
import { nextSort, songQueryFromParams, songQueryToParams } from '../../browse/song-query-params'
import {
    emptySelection,
    sameQuery,
    selectionAfterRefetch,
    type SongSelectionState,
} from '../../browse/song-selection'
import { SongTableComponent } from '../song-table/song-table.component'

export type EntitySongsKind = 'genre' | 'recordLabel' | 'artist'

/** How each detail page scopes its tracks, and the `/tracks` query param that carries that scope. */
const KINDS: Record<EntitySongsKind, { name: string; param: string; filter: (id: string) => SongFilter }> = {
    genre: { name: 'genre', param: 'genre', filter: id => ({ genreIds: [id] }) },
    recordLabel: { name: 'record label', param: 'recordLabel', filter: id => ({ recordLabelIds: [id] }) },
    artist: { name: 'artist', param: 'artist', filter: id => ({ artistIds: [id] }) },
}

@Component({
    selector: 'app-entity-songs',
    templateUrl: './entity-songs.component.html',
    changeDetection: ChangeDetectionStrategy.OnPush,
    imports: [HlmButton, SongTableComponent],
    host: { class: 'flex min-h-0 min-w-0 flex-1 flex-col' },
})
export class EntitySongsComponent {
    entityId = input.required<string>()
    kind = input.required<EntitySongsKind>()
    private scope = computed(() => KINDS[this.kind()])
    protected entityName = computed(() => this.scope().name)
    private route = inject(ActivatedRoute)
    private router = inject(Router)
    private service = inject(LibraryBrowseService)
    private history = inject(HistoryService)
    private table = viewChild(SongTableComponent)
    private params = toSignal(this.route.queryParams, { initialValue: {} })
    protected query = computed<SongQuery>(
        () => ({
            ...songQueryFromParams(this.params()),
            filter: this.scope().filter(this.entityId()),
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
            offset: untracked(() => listWindowOffsetAt(this.restoreScrollTop() ?? 0)),
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
    protected onMissing(): void {
        this.router.navigate(['/tracks'], {
            queryParams: { [this.scope().param]: this.entityId(), presence: 'missing' },
        })
    }
    protected onRetry(): void {
        this.browse.retry()
    }
    protected onScrollRestored(): void {
        this.restoreScrollTop.set(null)
        this.history.consumeScrollRestore()
    }
}
