import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core'
import { toObservable, toSignal } from '@angular/core/rxjs-interop'
import { ActivatedRoute, RouterLink } from '@angular/router'
import { ExternalRefKeys, type RecordLabelDetail } from '@release-maestro/core'
import { catchError, defer, map, merge, of, startWith, Subject, switchMap } from 'rxjs'
import { LibraryBrowseService } from '../../core/services/library-browse.service'
import { libraryBrowseRefresh } from '../../shared/browse/library-browse-refresh'
import { TabBarComponent, type Tab } from '../../shared/components/tab-bar/tab-bar.component'
import { EntitySongsComponent } from '../../shared/components/entity-songs/entity-songs.component'
import { EntityAlbumsComponent } from '../../shared/components/entity-albums/entity-albums.component'
import { RecordLabelArtistsComponent } from './record-label-artists.component'

type Section = 'tracks' | 'albums' | 'artists'
type DetailState =
    { status: 'ready'; recordLabel: RecordLabelDetail } | { status: 'loading' | 'missing' | 'error' }
const LOADING: DetailState = { status: 'loading' }
const ALBUMS = { section: 'albums' }
const ARTISTS = { section: 'artists' }

@Component({
    selector: 'app-record-label-detail',
    templateUrl: './record-label-detail.component.html',
    changeDetection: ChangeDetectionStrategy.OnPush,
    imports: [
        RouterLink,
        TabBarComponent,
        EntitySongsComponent,
        EntityAlbumsComponent,
        RecordLabelArtistsComponent,
    ],
    host: { class: 'flex min-h-0 min-w-0 flex-1 flex-col' },
})
export class RecordLabelDetailComponent {
    private route = inject(ActivatedRoute)
    private service = inject(LibraryBrowseService)
    private recordLabelId = toSignal(
        this.route.paramMap.pipe(map(params => params.get('recordLabelId') ?? '')),
        { initialValue: '' },
    )
    private params = toSignal(this.route.queryParamMap)
    protected section = computed<Section>(() => {
        const section = this.params()?.get('section')
        return section == 'albums' || section == 'artists' ? section : 'tracks'
    })
    private retry$ = new Subject<void>()
    private refresh$ = merge(libraryBrowseRefresh(), this.retry$)
    protected detail = toSignal(
        toObservable(this.recordLabelId).pipe(
            switchMap(recordLabelId =>
                this.refresh$.pipe(
                    startWith(null),
                    switchMap(() =>
                        defer(() => this.service.getRecordLabelDetail(recordLabelId)).pipe(
                            map((recordLabel): DetailState =>
                                recordLabel ? { status: 'ready', recordLabel } : { status: 'missing' },
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
    protected content = computed(() => {
        const state = this.detail()
        return state.status == 'ready'
            ? [{ key: `${state.recordLabel.id}:${this.section()}`, recordLabel: state.recordLabel }]
            : []
    })
    protected sections = computed<Tab<Section>[]>(() => {
        const state = this.detail()
        if (state.status != 'ready') return []
        return [
            { key: 'tracks', label: 'Tracks', count: state.recordLabel.songCount },
            { key: 'albums', label: 'Albums', count: state.recordLabel.albumCount, queryParams: ALBUMS },
            { key: 'artists', label: 'Artists', count: state.recordLabel.artistCount, queryParams: ARTISTS },
        ]
    })
    protected years = computed(() => {
        const state = this.detail()
        if (state.status != 'ready' || state.recordLabel.firstYear == null) return 'Years active unknown'
        const { firstYear, lastYear } = state.recordLabel
        return firstYear == lastYear ? `${firstYear}` : `${firstYear}–${lastYear}`
    })
    protected links = computed(() => {
        const state = this.detail()
        if (state.status != 'ready') return []
        const refs = state.recordLabel.externalRefs
        const entries = [
            { key: ExternalRefKeys.DiscogsLabelLink, name: 'Discogs', prefix: '', domain: 'discogs.com' },
            { key: ExternalRefKeys.BeatportLabelUrl, name: 'Beatport', prefix: '', domain: 'beatport.com' },
            { key: ExternalRefKeys.BandcampLabelUrl, name: 'Bandcamp', prefix: '', domain: 'bandcamp.com' },
            {
                key: ExternalRefKeys.MusicBrainzLabelId,
                name: 'MusicBrainz',
                prefix: 'https://musicbrainz.org/label/',
                domain: 'musicbrainz.org',
            },
        ] as const
        return entries.flatMap(({ key, name, prefix, domain }) =>
            (refs[key] ?? []).flatMap(value => {
                const url = prefix ? `${prefix}${encodeURIComponent(value)}` : value
                try {
                    const parsed = new URL(url)
                    return ['http:', 'https:'].includes(parsed.protocol) &&
                        (parsed.hostname === domain || parsed.hostname.endsWith(`.${domain}`))
                        ? [{ name, url }]
                        : []
                } catch {
                    return []
                }
            }),
        )
    })
    protected onRetry(): void {
        this.retry$.next()
    }
}
