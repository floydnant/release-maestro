import { ComponentFixture, TestBed, waitForAsync } from '@angular/core/testing'
import { provideRouter } from '@angular/router'
import { provideTranslateService } from '@ngx-translate/core'
import { HydratedFeedItem, ScrapedLinkMetadata } from '@release-maestro/core'
import { fromPartial } from '@total-typescript/shoehorn'
import { EMPTY } from 'rxjs'
import { FeedService } from '../../core/services/feed.service'
import { SettingsService } from '../../core/settings/settings.service'
import { provideWebAudioPlayerMock } from '../../../test/mocks'
import { FeedComponent } from './feed.component'

const createRelease = (id: string, linkUrls: string[]): HydratedFeedItem => ({
    id,
    type: 'BANDCAMP.TRALBUM',
    sourceType: 'EMAIL.BANDCAMP_NEW_RELEASE',
    error: null,
    data: {
        releaseUrl: `https://artist.bandcamp.com/album/${id}`,
        releaseDate: null,
        emailReceivedAt: new Date('2026-06-20T10:00:00.000Z'),
        isEmailRead: false,
        emailId: `email-${id}`,
        fans: [],
        releaseName: id,
        band: null,
        artist: null,
        releaseType: 'album',
        about: '',
        links: linkUrls.map(url => ({ url, title: url, favicon: undefined })),
        unsubscribeUrl: null,
        unsubscribeText: '',
        imageUrl: undefined,
        iframeUrl: null,
        tracks: [],
    },
})

const createPreview = (url: string, title: string): ScrapedLinkMetadata => ({
    url,
    title,
    description: null,
    image: null,
    favicon: `${url}/favicon.ico`,
})

describe(FeedComponent.name, () => {
    let component: FeedComponent
    let fixture: ComponentFixture<FeedComponent>
    let audioPlayer: ReturnType<typeof provideWebAudioPlayerMock>['useValue']
    let feedService: {
        emailImportProgress$: typeof EMPTY
        loadFeed: jest.Mock<Promise<HydratedFeedItem[]>>
        loadLinkPreviews: jest.Mock<Promise<Record<string, ScrapedLinkMetadata>>, [string[]]>
        hasFeed: jest.Mock<Promise<boolean>>
        markFeedItemViewed: jest.Mock<Promise<void>>
    }

    beforeEach(waitForAsync(() => {
        const audioPlayerProvider = provideWebAudioPlayerMock()
        audioPlayer = audioPlayerProvider.useValue
        feedService = {
            emailImportProgress$: EMPTY,
            loadFeed: jest.fn().mockResolvedValue([]),
            loadLinkPreviews: jest.fn().mockResolvedValue({}),
            hasFeed: jest.fn().mockResolvedValue(false),
            markFeedItemViewed: jest.fn().mockResolvedValue(undefined),
        }
        void TestBed.configureTestingModule({
            declarations: [],
            imports: [FeedComponent],
            providers: [
                provideTranslateService(),
                provideRouter([]),
                audioPlayerProvider,
                {
                    provide: SettingsService,
                    useValue: fromPartial<SettingsService>({ settings: { hasValue: () => false } }),
                },
                {
                    provide: FeedService,
                    useValue: feedService satisfies Partial<FeedService>,
                },
            ],
        }).compileComponents()

        fixture = TestBed.createComponent(FeedComponent)
        component = fixture.componentInstance
        fixture.detectChanges()
    }))

    it('should create', () => {
        expect(component).toBeTruthy()
    })

    it('requests remaining releases from the start while excluding already loaded releases', async () => {
        await fixture.whenStable()
        const feed = TestBed.inject(FeedService)
        component.loadedFeedItemIds.add('already-loaded')
        component.furthestScrolledIndex.set(1)
        fixture.detectChanges()
        await fixture.whenStable()
        expect(feed.loadFeed).toHaveBeenLastCalledWith(0, 6, ['already-loaded'])
    })

    it('loads link previews one release at a time without holding up the feed', async () => {
        const first = createRelease('first', [
            'https://first.example',
            'https://shared.example',
            'https://first.example',
        ])
        const second = createRelease('second', ['https://shared.example', 'https://second.example'])
        const third = createRelease('third', [
            'https://second.example',
            'https://first.example',
            'https://third.example',
        ])
        let resolveFirstBatch!: (previews: Record<string, ScrapedLinkMetadata>) => void
        feedService.loadFeed.mockResolvedValue([first, second, third])
        feedService.loadLinkPreviews
            .mockReturnValueOnce(new Promise(resolve => (resolveFirstBatch = resolve)))
            .mockRejectedValueOnce(new Error('Preview lookup failed'))
            .mockResolvedValueOnce({
                'https://third.example': createPreview('https://third.example', 'Third Site'),
            })
        jest.spyOn(console, 'warn').mockImplementation()
        // jsdom has no IntersectionObserver; rendered releases need one for scroll tracking.
        Object.defineProperty(window, 'IntersectionObserver', {
            configurable: true,
            value: class {
                observe = jest.fn()
                disconnect = jest.fn()
            },
        })

        const feedFixture = TestBed.createComponent(FeedComponent)
        const settle = async () => {
            feedFixture.detectChanges()
            await feedFixture.whenStable()
            feedFixture.detectChanges()
        }
        const text = () => (feedFixture.nativeElement as HTMLElement).textContent ?? ''
        await settle()

        expect(text()).toContain('https://first.example')
        expect(feedService.loadLinkPreviews.mock.calls).toEqual([
            [['https://first.example', 'https://shared.example']],
        ])

        resolveFirstBatch({ 'https://first.example': createPreview('https://first.example', 'First Site') })
        await settle()

        // The second release's batch fails; the third still loads, and no URL is asked for twice.
        expect(feedService.loadLinkPreviews.mock.calls).toEqual([
            [['https://first.example', 'https://shared.example']],
            [['https://second.example']],
            [['https://third.example']],
        ])
        expect(text()).toContain('First Site')
        expect(text()).toContain('Third Site')
        expect(text()).toContain('https://second.example')
    })

    it('starts a new track at the point selected on its seeker', () => {
        const trackSeeker = document.createElement('button')
        jest.spyOn(trackSeeker, 'getBoundingClientRect').mockReturnValue(
            fromPartial({
                left: 100,
                width: 200,
            }),
        )

        component.seekTrack(
            fromPartial({ currentTarget: trackSeeker, clientX: 150 }),
            'https://example.com/preview.mp3',
        )

        expect(audioPlayer.playSource).toHaveBeenCalledWith('https://example.com/preview.mp3', 0.25)
    })

    it('seeks an active track without restarting it', () => {
        const trackSeeker = document.createElement('button')
        jest.spyOn(trackSeeker, 'getBoundingClientRect').mockReturnValue(
            fromPartial({
                left: 40,
                width: 160,
            }),
        )
        audioPlayer.currentUrl.set('https://example.com/preview.mp3')

        component.seekTrack(
            fromPartial({ currentTarget: trackSeeker, clientX: 160 }),
            'https://example.com/preview.mp3',
        )

        expect(audioPlayer.seekTo).toHaveBeenCalledWith(0.75)
        expect(audioPlayer.playSource).not.toHaveBeenCalled()
    })

    it('toggles playback for the active track', () => {
        const streamUrl = 'https://example.com/preview.mp3'
        audioPlayer.currentUrl.set(streamUrl)

        component.toggleTrackPlayback(streamUrl)

        expect(audioPlayer.togglePlay).toHaveBeenCalledTimes(1)
        expect(audioPlayer.playSource).not.toHaveBeenCalled()
    })

    it('starts a different track from the beginning when its control is clicked', () => {
        const scrollCurrentTrackIntoView = jest
            .spyOn(component, 'scrollCurrentTrackIntoView')
            .mockImplementation()

        component.toggleTrackPlayback('https://example.com/another-preview.mp3')

        expect(audioPlayer.playSource).toHaveBeenCalledWith('https://example.com/another-preview.mp3')
        expect(scrollCurrentTrackIntoView).toHaveBeenCalledTimes(1)
    })

    it('reports the current track progress as a bounded percentage', () => {
        const streamUrl = 'https://example.com/preview.mp3'
        audioPlayer.currentUrl.set(streamUrl)
        audioPlayer.duration.set(200)
        audioPlayer.playerTime.set(50)

        expect(component.trackProgress(streamUrl)).toBe(25)

        audioPlayer.playerTime.set(300)

        expect(component.trackProgress(streamUrl)).toBe(100)
        expect(component.trackProgress('https://example.com/another-preview.mp3')).toBe(0)
    })
})
