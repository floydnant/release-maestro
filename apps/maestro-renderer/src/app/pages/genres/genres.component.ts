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
import { takeUntilDestroyed, toSignal } from '@angular/core/rxjs-interop'
import { ActivatedRoute, Router } from '@angular/router'
import type { BrowseWindow, GenreQuery } from '@release-maestro/core'
import { debounceTime, filter, Subject } from 'rxjs'
import { HistoryService } from '../../core/services/history.service'
import { LibraryBrowseService } from '../../core/services/library-browse.service'
import { createBrowseQuery } from '../../shared/browse/browse-query'
import {
    genreQueryFromParams,
    genreQueryToParams,
    sameGenreQuery,
} from '../../shared/browse/genre-query-params'
import { libraryBrowseRefresh } from '../../shared/browse/library-browse-refresh'
import { BrowseShellComponent } from '../../shared/components/browse-shell/browse-shell.component'
import {
    CatalogListComponent,
    catalogWindowOffsetAt,
} from '../../shared/components/catalog-list/catalog-list.component'

@Component({
    selector: 'app-genres',
    templateUrl: './genres.component.html',
    changeDetection: ChangeDetectionStrategy.OnPush,
    imports: [BrowseShellComponent, CatalogListComponent],
    host: { class: 'flex min-h-0 min-w-0 flex-1 flex-col' },
})
export class GenresComponent {
    private route = inject(ActivatedRoute)
    private router = inject(Router)
    private service = inject(LibraryBrowseService)
    private history = inject(HistoryService)
    private list = viewChild(CatalogListComponent)
    private params = toSignal(this.route.queryParams, { initialValue: {} })
    protected query = computed(() => genreQueryFromParams(this.params()), { equal: sameGenreQuery })
    protected restoreScrollTop = linkedSignal<GenreQuery, number | null>({
        source: this.query,
        computation: () => untracked(() => this.history.scrollRestore()),
    })
    protected viewport = linkedSignal<GenreQuery, BrowseWindow>({
        source: this.query,
        computation: (_query, previous) => ({
            offset: untracked(() => catalogWindowOffsetAt(this.restoreScrollTop() ?? 0)),
            limit: previous?.value.limit ?? 60,
        }),
    })
    private browse = createBrowseQuery({
        query: this.query,
        viewport: this.viewport,
        sameQuery: sameGenreQuery,
        entityLabel: 'genres',
        refresh: libraryBrowseRefresh(),
        fetchWindow: (query, window) => this.service.queryGenres(query, window),
    })
    protected result = computed(() => ({
        ...this.browse.result(),
        rows: this.browse.result().rows.map(row => ({
            ...row,
            link: ['/genres', row.id],
            counts: row,
        })),
    }))
    protected shellState = computed(() => ({
        ...this.browse.result(),
        entityLabel: 'genres',
        entityLabelSingular: 'genre',
    }))
    protected filters = computed(() => ({ search: this.query().search, chips: [], hasFilter: false }))
    private search$ = new Subject<string>()

    constructor() {
        const unregister = this.history.registerScrollProvider(() => this.list()?.scrollTop() ?? null)
        inject(DestroyRef).onDestroy(unregister)
        // The subscription performs navigation, rather than copying stream values into state.
        this.search$
            .pipe(
                debounceTime(200),
                filter(search => search != this.query().search),
                takeUntilDestroyed(),
            )
            .subscribe(search => this.patchQuery({ ...this.query(), search }))
    }
    protected onSearch(search: string): void {
        this.search$.next(search)
    }
    protected onClear(): void {
        this.search$.next('')
        this.patchQuery({ ...this.query(), search: '' })
    }
    protected onSort(): void {
        this.patchQuery({
            ...this.query(),
            sort: { field: 'name', direction: this.query().sort.direction == 'asc' ? 'desc' : 'asc' },
        })
    }
    protected onRetry(): void {
        this.browse.retry()
    }
    protected onScrollRestored(): void {
        this.restoreScrollTop.set(null)
        this.history.consumeScrollRestore()
    }
    private patchQuery(query: GenreQuery): void {
        this.router.navigate([], {
            relativeTo: this.route,
            queryParams: genreQueryToParams(query),
            queryParamsHandling: 'merge',
            replaceUrl: true,
        })
    }
}
