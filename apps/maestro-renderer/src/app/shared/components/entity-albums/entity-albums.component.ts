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
import type { AlbumQuery, AlbumSortField, BrowseWindow } from '@release-maestro/core'
import { HistoryService } from '../../../core/services/history.service'
import { LibraryBrowseService } from '../../../core/services/library-browse.service'
import {
    albumQueryFromParams,
    albumQueryToParams,
    nextAlbumSort,
    sameAlbumQuery,
} from '../../browse/album-query-params'
import { createBrowseQuery } from '../../browse/browse-query'
import { libraryBrowseRefresh } from '../../browse/library-browse-refresh'
import {
    AlbumGridComponent,
    estimatedAlbumWindowOffsetAt,
    initialWindowLimit,
} from '../album-grid/album-grid.component'
import { AlbumSortBarComponent } from '../album-grid/album-sort-bar.component'

export type EntityAlbumsKind = 'genre' | 'recordLabel' | 'artist' | 'artistAppearances'

/** How each detail page scopes its albums. An artist's appearances are albums it is not an album artist of. */
const KINDS: Record<
    EntityAlbumsKind,
    { name: string; scope: (id: string) => Pick<AlbumQuery, 'filter' | 'appearanceArtistId'> }
> = {
    genre: { name: 'genre', scope: id => ({ filter: { genreIds: [id] } }) },
    recordLabel: { name: 'record label', scope: id => ({ filter: { recordLabelIds: [id] } }) },
    artist: { name: 'artist', scope: id => ({ filter: { albumArtistIds: [id] } }) },
    artistAppearances: { name: 'artist', scope: id => ({ filter: {}, appearanceArtistId: id }) },
}

@Component({
    selector: 'app-entity-albums',
    templateUrl: './entity-albums.component.html',
    changeDetection: ChangeDetectionStrategy.OnPush,
    imports: [HlmButton, AlbumGridComponent, AlbumSortBarComponent],
    host: { class: 'flex min-h-0 min-w-0 flex-1 flex-col' },
})
export class EntityAlbumsComponent {
    entityId = input.required<string>()
    kind = input.required<EntityAlbumsKind>()
    protected entityName = computed(() => KINDS[this.kind()].name)
    private service = inject(LibraryBrowseService)
    private route = inject(ActivatedRoute)
    private router = inject(Router)
    private history = inject(HistoryService)
    private grid = viewChild(AlbumGridComponent)
    private params = toSignal(this.route.queryParams, { initialValue: {} })
    protected query = computed<AlbumQuery>(
        () => ({
            ...albumQueryFromParams(this.params()),
            ...KINDS[this.kind()].scope(this.entityId()),
        }),
        { equal: sameAlbumQuery },
    )
    protected restoreScrollTop = linkedSignal<AlbumQuery, number | null>({
        source: this.query,
        computation: () => untracked(() => this.history.scrollRestore()),
    })
    protected viewport = linkedSignal<AlbumQuery, BrowseWindow>({
        source: this.query,
        computation: (_query, previous) => ({
            offset: untracked(() =>
                estimatedAlbumWindowOffsetAt(this.restoreScrollTop() ?? 0, window.innerWidth),
            ),
            limit: previous?.value.limit ?? initialWindowLimit(window.innerWidth, window.innerHeight),
        }),
    })
    private browse = createBrowseQuery({
        query: this.query,
        viewport: this.viewport,
        sameQuery: sameAlbumQuery,
        entityLabel: 'albums',
        refresh: libraryBrowseRefresh(),
        fetchWindow: (query, window) => this.service.queryAlbums(query, window),
    })
    protected result = this.browse.result
    constructor() {
        const unregister = this.history.registerScrollProvider(() => this.grid()?.scrollTop() ?? null)
        inject(DestroyRef).onDestroy(unregister)
    }
    protected onSort(field: AlbumSortField): void {
        this.router.navigate([], {
            relativeTo: this.route,
            queryParams: albumQueryToParams({
                ...this.query(),
                filter: {},
                sort: nextAlbumSort(this.query().sort, field),
            }),
            queryParamsHandling: 'merge',
            replaceUrl: true,
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
