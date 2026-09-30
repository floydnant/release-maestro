import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core'
import { toObservable, toSignal } from '@angular/core/rxjs-interop'
import { ActivatedRoute, RouterLink } from '@angular/router'
import { ExternalRefKeys, type ArtistDetail } from '@release-maestro/core'
import { catchError, defer, map, merge, of, startWith, Subject, switchMap } from 'rxjs'
import { LibraryBrowseService } from '../../core/services/library-browse.service'
import {
    bandcampSearchLink,
    externalLinks,
    type ExternalLink,
    type ExternalLinkSpec,
} from '../../shared/browse/external-links'
import { libraryBrowseRefresh } from '../../shared/browse/library-browse-refresh'
import { yearRange } from '../../shared/browse/year-range'
import { TabBarComponent, type Tab } from '../../shared/components/tab-bar/tab-bar.component'
import { EntityAlbumsComponent } from '../../shared/components/entity-albums/entity-albums.component'
import { EntitySongsComponent } from '../../shared/components/entity-songs/entity-songs.component'
import { ExternalLinksComponent } from '../../shared/components/external-links/external-links.component'
import { ArtistRecordLabelsComponent } from './artist-record-labels.component'

type ArtistSection = 'albums' | 'songs' | 'recordLabels' | 'appearsOn'
type DetailState = { status: 'ready'; artist: ArtistDetail } | { status: 'loading' | 'missing' | 'error' }
const LOADING: DetailState = { status: 'loading' }
const ALBUMS = { section: 'albums' }
const SONGS = { section: 'songs' }
const LABELS = { section: 'recordLabels' }
const APPEARS = { section: 'appearsOn' }

const LINKS: ExternalLinkSpec[] = [
    {
        key: ExternalRefKeys.MusicBrainzArtistId,
        label: 'MusicBrainz',
        base: 'https://musicbrainz.org/artist/',
    },
    { key: ExternalRefKeys.DiscogsArtistLink, label: 'Discogs', domain: 'discogs.com' },
    { key: ExternalRefKeys.DiscogsArtistId, label: 'Discogs', base: 'https://www.discogs.com/artist/' },
    { key: ExternalRefKeys.BeatportArtistUrl, label: 'Beatport', domain: 'beatport.com' },
]
const artistLinks = (artist: ArtistDetail): ExternalLink[] => [
    ...externalLinks(artist.externalRefs, LINKS),
    ...(artist.externalRefs[ExternalRefKeys.BandcampArtistId]?.length
        ? [bandcampSearchLink(artist.name)]
        : []),
]

@Component({
    selector: 'app-artist-detail',
    templateUrl: './artist-detail.component.html',
    changeDetection: ChangeDetectionStrategy.OnPush,
    imports: [
        RouterLink,
        TabBarComponent,
        EntityAlbumsComponent,
        EntitySongsComponent,
        ExternalLinksComponent,
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
        if (
            section == 'albums' ||
            section == 'songs' ||
            section == 'recordLabels' ||
            section == 'appearsOn'
        ) {
            return section
        }
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
        return state.status == 'ready' ? artistLinks(state.artist) : []
    })
    protected years = computed(() => {
        const state = this.detail()
        return state.status == 'ready' ? yearRange(state.artist.firstYear, state.artist.lastYear) : null
    })
    protected sections = computed<Tab<ArtistSection>[]>(() => {
        const state = this.detail()
        if (state.status != 'ready') return []
        const artist = state.artist
        return [
            { key: 'albums', label: 'Albums', count: artist.albumCount, queryParams: ALBUMS },
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
