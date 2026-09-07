import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core'
import { DecimalPipe } from '@angular/common'
import { toObservable, toSignal } from '@angular/core/rxjs-interop'
import { ActivatedRoute, RouterLink } from '@angular/router'
import type { GenreDetail, GenreRelatedKind } from '@release-maestro/core'
import { catchError, defer, map, merge, of, startWith, Subject, switchMap } from 'rxjs'
import { LibraryBrowseService } from '../../core/services/library-browse.service'
import { libraryBrowseRefresh } from '../../shared/browse/library-browse-refresh'
import { GenreSongsComponent } from './genre-songs.component'
import { GenreAlbumsComponent } from './genre-albums.component'
import { GenreRelatedComponent } from './genre-related.component'
import { IconComponent } from '../../shared/components/icon/icon.component'

type DetailState = { status: 'ready'; genre: GenreDetail } | { status: 'loading' | 'missing' | 'error' }
const LOADING: DetailState = { status: 'loading' }

@Component({
    selector: 'app-genre-detail',
    templateUrl: './genre-detail.component.html',
    changeDetection: ChangeDetectionStrategy.OnPush,
    imports: [
        DecimalPipe,
        RouterLink,
        IconComponent,
        GenreSongsComponent,
        GenreRelatedComponent,
        GenreAlbumsComponent,
    ],
    host: { class: 'flex min-h-0 min-w-0 flex-1 flex-col' },
})
export class GenreDetailComponent {
    private route = inject(ActivatedRoute)
    private service = inject(LibraryBrowseService)
    private genreId = toSignal(this.route.paramMap.pipe(map(params => params.get('genreId') ?? '')), {
        initialValue: '',
    })
    private params = toSignal(this.route.queryParamMap)
    protected section = computed<GenreRelatedKind | 'songs' | 'albums'>(() => {
        const section = this.params()?.get('section')
        return section == 'artists' || section == 'albums' || section == 'recordLabels' ? section : 'songs'
    })
    private retry$ = new Subject<void>()
    private refresh$ = merge(libraryBrowseRefresh(), this.retry$)
    protected detail = toSignal(
        toObservable(this.genreId).pipe(
            switchMap(genreId =>
                this.refresh$.pipe(
                    startWith(null),
                    switchMap(() =>
                        defer(() => this.service.getGenreDetail(genreId)).pipe(
                            map((genre): DetailState =>
                                genre ? { status: 'ready', genre } : { status: 'missing' },
                            ),
                            catchError(() => of<DetailState>({ status: 'error' })),
                        ),
                    ),
                    startWith(LOADING),
                ),
            ),
        ),
        { initialValue: LOADING },
    )
    // Key the content by genre and section so retained windows cannot cross either boundary.
    protected content = computed(() => {
        const state = this.detail()
        return state.status == 'ready'
            ? [{ key: `${state.genre.id}:${this.section()}`, genre: state.genre }]
            : []
    })
    /**
     * The section tabs, counts included. Built here rather than as four literal links in
     * the template: the four differ only in label, count and query params, and one
     * definition is what keeps their styling and their `aria-current` rule in step.
     */
    protected sections = computed(() => {
        const state = this.detail()
        if (state.status != 'ready') return []
        const genre = state.genre
        const active = this.section()
        return [
            { key: 'songs', label: 'Tracks', count: genre.songCount, params: {} },
            { key: 'artists', label: 'Artists', count: genre.artistCount, params: { section: 'artists' } },
            { key: 'albums', label: 'Albums', count: genre.albumCount, params: { section: 'albums' } },
            {
                key: 'recordLabels',
                label: 'Record labels',
                count: genre.recordLabelCount,
                params: { section: 'recordLabels' },
            },
        ].map(tab => ({ ...tab, current: tab.key == active }))
    })
    protected relatedQuery = computed(() => {
        const section = this.section()
        return section == 'songs' || section == 'albums' ? null : { genreId: this.genreId(), kind: section }
    })
    protected relatedLabel = computed(
        () =>
            ({ songs: 'Tracks', artists: 'Artists', albums: 'Albums', recordLabels: 'Record labels' })[
                this.section()
            ],
    )
    protected onRetry(): void {
        this.retry$.next()
    }
}
