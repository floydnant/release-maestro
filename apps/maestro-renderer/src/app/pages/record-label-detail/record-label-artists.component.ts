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
import type { BrowseWindow } from '@release-maestro/core'
import { HistoryService } from '../../core/services/history.service'
import { LibraryBrowseService } from '../../core/services/library-browse.service'
import { createBrowseQuery } from '../../shared/browse/browse-query'
import { listWindowOffsetAt } from '../../shared/browse/list-window'
import { libraryBrowseRefresh } from '../../shared/browse/library-browse-refresh'
import { CatalogListComponent } from '../../shared/components/catalog-list/catalog-list.component'

@Component({
    selector: 'app-record-label-artists',
    templateUrl: './record-label-artists.component.html',
    changeDetection: ChangeDetectionStrategy.OnPush,
    imports: [CatalogListComponent],
    host: { class: 'flex min-h-0 min-w-0 flex-1 flex-col' },
})
export class RecordLabelArtistsComponent {
    recordLabelId = input.required<string>()
    private service = inject(LibraryBrowseService)
    private history = inject(HistoryService)
    private list = viewChild(CatalogListComponent)
    protected restoreScrollTop = linkedSignal<string, number | null>({
        source: this.recordLabelId,
        computation: () => untracked(() => this.history.scrollRestore()),
    })
    protected viewport = linkedSignal<string, BrowseWindow>({
        source: this.recordLabelId,
        computation: () => ({
            offset: untracked(() => listWindowOffsetAt(this.restoreScrollTop() ?? 0)),
            limit: 60,
        }),
    })
    private browse = createBrowseQuery({
        query: this.recordLabelId,
        viewport: this.viewport,
        refresh: libraryBrowseRefresh(),
        fetchWindow: (query, window) => this.service.queryRecordLabelArtists(query, window),
    })
    protected result = computed(() => ({
        ...this.browse.result(),
        rows: this.browse.result().rows.map(row => ({
            ...row,
            link: row.hasSongCredits ? ['/tracks'] : ['/albums'],
            queryParams: row.hasSongCredits
                ? { recordLabel: this.recordLabelId(), artist: row.id }
                : { recordLabel: this.recordLabelId(), albumArtist: row.id },
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
