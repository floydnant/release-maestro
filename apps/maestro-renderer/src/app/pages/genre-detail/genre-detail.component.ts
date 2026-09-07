import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core'
import { toObservable, toSignal } from '@angular/core/rxjs-interop'
import { ActivatedRoute, RouterLink } from '@angular/router'
import type { GenreDetail, GenreRelatedKind } from '@release-maestro/core'
import { catchError, defer, map, merge, of, startWith, Subject, switchMap } from 'rxjs'
import { LibraryBrowseService } from '../../core/services/library-browse.service'
import { libraryBrowseRefresh } from '../../shared/browse/library-browse-refresh'
import { GenreSongsComponent } from './genre-songs.component'
import { GenreAlbumsComponent } from './genre-albums.component'
import { GenreRelatedComponent } from './genre-related.component'
import { TabBarComponent, type Tab } from '../../shared/components/tab-bar/tab-bar.component'

/** The sections a genre is browsable by, `songs` being the one the bare route opens. */
type GenreSection = GenreRelatedKind | 'songs' | 'albums'

// Literals rather than object literals in the list: a tab's `queryParams` identity is
// what `RouterLink` diffs on, and a fresh object every read re-runs that on every check.
const SECTION_ARTISTS = { section: 'artists' }
const SECTION_ALBUMS = { section: 'albums' }
const SECTION_RECORD_LABELS = { section: 'recordLabels' }

type DetailState = { status: 'ready'; genre: GenreDetail } | { status: 'loading' | 'missing' | 'error' }
const LOADING: DetailState = { status: 'loading' }

@Component({
    selector: 'app-genre-detail',
    templateUrl: './genre-detail.component.html',
    changeDetection: ChangeDetectionStrategy.OnPush,
    imports: [RouterLink, TabBarComponent, GenreSongsComponent, GenreRelatedComponent, GenreAlbumsComponent],
    host: { class: 'flex min-h-0 min-w-0 flex-1 flex-col' },
})
export class GenreDetailComponent {
    private route = inject(ActivatedRoute)
    private service = inject(LibraryBrowseService)
    private genreId = toSignal(this.route.paramMap.pipe(map(params => params.get('genreId') ?? '')), {
        initialValue: '',
    })
    private params = toSignal(this.route.queryParamMap)
    protected section = computed<GenreSection>(() => {
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
     * The section tabs, counts included. The bar owns how they look and where a click
     * lands; which sections exist and how many things are in each is this page's.
     */
    protected sections = computed<Tab<GenreSection>[]>(() => {
        const state = this.detail()
        if (state.status != 'ready') return []
        const genre = state.genre
        return [
            { key: 'songs', label: 'Tracks', count: genre.songCount },
            { key: 'artists', label: 'Artists', count: genre.artistCount, queryParams: SECTION_ARTISTS },
            { key: 'albums', label: 'Albums', count: genre.albumCount, queryParams: SECTION_ALBUMS },
            {
                key: 'recordLabels',
                label: 'Record labels',
                count: genre.recordLabelCount,
                queryParams: SECTION_RECORD_LABELS,
            },
        ]
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
