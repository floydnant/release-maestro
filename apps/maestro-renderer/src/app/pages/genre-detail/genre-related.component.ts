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
import type { BrowseWindow, GenreRelatedQuery } from '@release-maestro/core'
import { HistoryService } from '../../core/services/history.service'
import { LibraryBrowseService } from '../../core/services/library-browse.service'
import { createBrowseQuery } from '../../shared/browse/browse-query'
import { libraryBrowseRefresh } from '../../shared/browse/library-browse-refresh'
import {
    CatalogListComponent,
    catalogWindowOffsetAt,
} from '../../shared/components/catalog-list/catalog-list.component'

@Component({
    selector: 'app-genre-related',
    templateUrl: './genre-related.component.html',
    changeDetection: ChangeDetectionStrategy.OnPush,
    imports: [CatalogListComponent],
    host: { class: 'flex min-h-0 min-w-0 flex-1 flex-col' },
})
export class GenreRelatedComponent {
    query = input.required<GenreRelatedQuery>()
    label = input.required<string>()
    private service = inject(LibraryBrowseService)
    private history = inject(HistoryService)
    private list = viewChild(CatalogListComponent)
    protected restoreScrollTop = linkedSignal<GenreRelatedQuery, number | null>({
        source: this.query,
        computation: () => untracked(() => this.history.scrollRestore()),
    })
    protected viewport = linkedSignal<GenreRelatedQuery, BrowseWindow>({
        source: this.query,
        computation: () => ({
            offset: untracked(() => catalogWindowOffsetAt(this.restoreScrollTop() ?? 0)),
            limit: 60,
        }),
    })
    private browse = createBrowseQuery({
        query: this.query,
        viewport: this.viewport,
        refresh: libraryBrowseRefresh(),
        fetchWindow: (query, window) => this.service.queryGenreRelated(query, window),
    })
    protected result = computed(() => ({
        ...this.browse.result(),
        rows: this.browse.result().rows.map(row => ({
            ...row,
            link: ['/tracks'],
            queryParams: {
                genre: this.query().genreId,
                [this.query().kind == 'artists' ? 'artist' : 'recordLabel']: row.id,
            },
        })),
    }))
    constructor() {
        const unregister = this.history.registerScrollProvider(() => this.list()?.scrollTop() ?? null)
        inject(DestroyRef).onDestroy(unregister)
    }
    protected onRetry(): void {
        this.browse.retry()
    }
    protected onScrollRestored(): void {
        this.restoreScrollTop.set(null)
        this.history.consumeScrollRestore()
    }
}
