import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core'
import { toObservable, toSignal } from '@angular/core/rxjs-interop'
import { ActivatedRoute, RouterLink } from '@angular/router'
import { ExternalRefKeys, type ArtistDetail } from '@release-maestro/core'
import { catchError, defer, map, merge, of, startWith, Subject, switchMap } from 'rxjs'
import { LibraryBrowseService } from '../../core/services/library-browse.service'
import { libraryBrowseRefresh } from '../../shared/browse/library-browse-refresh'
import { TabBarComponent, type Tab } from '../../shared/components/tab-bar/tab-bar.component'
import { ArtistAlbumsComponent } from './artist-albums.component'
import { ArtistSongsComponent } from './artist-songs.component'
import { ArtistRecordLabelsComponent } from './artist-record-labels.component'

type ArtistSection = 'albums' | 'songs' | 'recordLabels' | 'appearsOn'
type DetailState = { status: 'ready'; artist: ArtistDetail } | { status: 'loading' | 'missing' | 'error' }
const LOADING: DetailState = { status: 'loading' }
const SONGS = { section: 'songs' }
const LABELS = { section: 'recordLabels' }
const APPEARS = { section: 'appearsOn' }

const externalLinks = (artist: ArtistDetail): { label: string; url: string }[] => {
    const refs = artist.externalRefs
    const links = [
        {
            label: 'MusicBrainz',
            value: refs[ExternalRefKeys.MusicBrainzArtistId]?.[0],
            base: 'https://musicbrainz.org/artist/',
        },
        { label: 'Discogs', value: refs[ExternalRefKeys.DiscogsArtistLink]?.[0] },
        { label: 'Beatport', value: refs[ExternalRefKeys.BeatportArtistUrl]?.[0] },
    ]
    const direct = links.flatMap(link => {
        if (!link.value) return []
        const url = link.base ? link.base + encodeURIComponent(link.value) : link.value
        try {
            if (new URL(url).protocol !== 'https:') return []
        } catch {
            return []
        }
        return [{ label: link.label, url }]
    })
    if (refs[ExternalRefKeys.BandcampArtistId]?.[0]) {
        direct.push({
            label: 'Search Bandcamp',
            url: `https://bandcamp.com/search?q=${encodeURIComponent(artist.name)}`,
        })
    }
    return direct
}

@Component({
    selector: 'app-artist-detail',
    templateUrl: './artist-detail.component.html',
    changeDetection: ChangeDetectionStrategy.OnPush,
    imports: [
        RouterLink,
        TabBarComponent,
        ArtistAlbumsComponent,
        ArtistSongsComponent,
        ArtistRecordLabelsComponent,
    ],
    host: { class: 'flex min-h-0 min-w-0 flex-1 flex-col' },
})
export class ArtistDetailComponent {
    private route = inject(ActivatedRoute)
    private service = inject(LibraryBrowseService)
    private artistId = toSignal(this.route.paramMap.pipe(map(params => params.get('artistId') ?? '')), {
        initialValue: '',
    })
    private params = toSignal(this.route.queryParamMap)
    private retry$ = new Subject<void>()
    private refresh$ = merge(libraryBrowseRefresh(), this.retry$)
    protected detail = toSignal(
        toObservable(this.artistId).pipe(
            switchMap(artistId =>
                this.refresh$.pipe(
                    startWith(null),
                    switchMap(() =>
                        defer(() => this.service.getArtistDetail(artistId)).pipe(
                            map((artist): DetailState =>
                                artist ? { status: 'ready', artist } : { status: 'missing' },
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
    protected section = computed<ArtistSection>(() => {
        const section = this.params()?.get('section')
        if (section == 'songs' || section == 'recordLabels' || section == 'appearsOn') return section
        const state = this.detail()
        return state.status == 'ready' && state.artist.albumCount == 0 && state.artist.songCount > 0
            ? 'songs'
            : 'albums'
    })
    protected content = computed(() => {
        const state = this.detail()
        return state.status == 'ready'
            ? [{ key: `${state.artist.id}:${this.section()}`, artist: state.artist }]
            : []
    })
    protected links = computed(() => {
        const state = this.detail()
        return state.status == 'ready' ? externalLinks(state.artist) : []
    })
    protected sections = computed<Tab<ArtistSection>[]>(() => {
        const state = this.detail()
        if (state.status != 'ready') return []
        const artist = state.artist
        return [
            { key: 'albums', label: 'Albums', count: artist.albumCount },
            { key: 'songs', label: 'All tracks', count: artist.songCount, queryParams: SONGS },
            {
                key: 'recordLabels',
                label: 'Released on record labels',
                count: artist.recordLabelCount,
                queryParams: LABELS,
            },
            { key: 'appearsOn', label: 'Appears on', count: artist.appearanceCount, queryParams: APPEARS },
        ]
    })
    protected onRetry(): void {
        this.retry$.next()
    }
}
