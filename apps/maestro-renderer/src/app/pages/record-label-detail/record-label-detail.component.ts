import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core'
import { toObservable, toSignal } from '@angular/core/rxjs-interop'
import { ActivatedRoute, RouterLink } from '@angular/router'
import { ExternalRefKeys, type RecordLabelDetail } from '@release-maestro/core'
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
import { EntitySongsComponent } from '../../shared/components/entity-songs/entity-songs.component'
import { EntityAlbumsComponent } from '../../shared/components/entity-albums/entity-albums.component'
import { ExternalLinksComponent } from '../../shared/components/external-links/external-links.component'
import { RecordLabelArtistsComponent } from './record-label-artists.component'

type Section = 'songs' | 'albums' | 'artists'
type DetailState =
    { status: 'ready'; recordLabel: RecordLabelDetail } | { status: 'loading' | 'missing' | 'error' }
const LOADING: DetailState = { status: 'loading' }
const ALBUMS = { section: 'albums' }
const ARTISTS = { section: 'artists' }

const LINKS: ExternalLinkSpec[] = [
    { key: ExternalRefKeys.MusicBrainzLabelId, label: 'MusicBrainz', base: 'https://musicbrainz.org/label/' },
    { key: ExternalRefKeys.DiscogsLabelLink, label: 'Discogs', domain: 'discogs.com' },
    { key: ExternalRefKeys.BeatportLabelUrl, label: 'Beatport', domain: 'beatport.com' },
    { key: ExternalRefKeys.BandcampLabelUrl, label: 'Bandcamp', domain: 'bandcamp.com' },
]
const recordLabelLinks = (recordLabel: RecordLabelDetail): ExternalLink[] => {
    const links = externalLinks(recordLabel.externalRefs, LINKS)
    // A stored page URL beats a search; the ID alone only proves the record label is on Bandcamp.
    const hasBandcampPage = links.some(link => link.label.startsWith('Bandcamp'))
    return recordLabel.externalRefs[ExternalRefKeys.BandcampLabelId]?.length && !hasBandcampPage
        ? [...links, bandcampSearchLink(recordLabel.name)]
        : links
}

@Component({
    selector: 'app-record-label-detail',
    templateUrl: './record-label-detail.component.html',
    changeDetection: ChangeDetectionStrategy.OnPush,
    imports: [
        RouterLink,
        TabBarComponent,
        EntitySongsComponent,
        EntityAlbumsComponent,
        ExternalLinksComponent,
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
        return section == 'albums' || section == 'artists' ? section : 'songs'
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
            { key: 'songs', label: 'Tracks', count: state.recordLabel.songCount },
            { key: 'albums', label: 'Albums', count: state.recordLabel.albumCount, queryParams: ALBUMS },
            { key: 'artists', label: 'Artists', count: state.recordLabel.artistCount, queryParams: ARTISTS },
        ]
    })
    protected years = computed(() => {
        const state = this.detail()
        return state.status == 'ready'
            ? yearRange(state.recordLabel.firstYear, state.recordLabel.lastYear)
            : null
    })
    protected links = computed(() => {
        const state = this.detail()
        return state.status == 'ready' ? recordLabelLinks(state.recordLabel) : []
    })
    protected onRetry(): void {
        this.retry$.next()
    }
}
