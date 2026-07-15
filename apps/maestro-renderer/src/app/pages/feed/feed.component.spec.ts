import { WritableSignal } from '@angular/core'
import { ComponentFixture, TestBed, waitForAsync } from '@angular/core/testing'
import { provideRouter } from '@angular/router'
import { TranslateModule } from '@ngx-translate/core'
import { EMPTY } from 'rxjs'
import { WebAudioPlayer } from '../../core/services/audio-player.service'
import { FeedService } from '../../core/services/feed.service'
import { provideWebAudioPlayerMock } from '../../../test/mocks'
import { FeedComponent } from './feed.component'

describe(FeedComponent.name, () => {
    let component: FeedComponent
    let fixture: ComponentFixture<FeedComponent>
    let audioPlayer: {
        currentUrl: WritableSignal<string | null>
        duration: WritableSignal<number>
        playSource: jest.Mock
        playerTime: WritableSignal<number>
        seekTo: jest.Mock
        togglePlay: jest.Mock
    }

    beforeEach(waitForAsync(() => {
        void TestBed.configureTestingModule({
            declarations: [],
            imports: [FeedComponent, TranslateModule.forRoot()],
            providers: [
                provideRouter([]),
                provideWebAudioPlayerMock(),
                {
                    provide: FeedService,
                    useValue: {
                        emailImportProgress$: EMPTY,
                        loadFeed: jest.fn().mockResolvedValue([]),
                        hasFeed: jest.fn().mockResolvedValue(false),
                        markFeedItemViewed: jest.fn().mockResolvedValue(undefined),
                    } satisfies Partial<FeedService>,
                },
            ],
        }).compileComponents()

        fixture = TestBed.createComponent(FeedComponent)
        component = fixture.componentInstance
        audioPlayer = TestBed.inject(WebAudioPlayer) as unknown as typeof audioPlayer
        fixture.detectChanges()
    }))

    it('should create', () => {
        expect(component).toBeTruthy()
    })

    it('starts a new track at the point selected on its seeker', () => {
        const trackSeeker = document.createElement('button')
        jest.spyOn(trackSeeker, 'getBoundingClientRect').mockReturnValue({
            left: 100,
            width: 200,
        } as DOMRect)

        component.seekTrack(
            { currentTarget: trackSeeker, clientX: 150 } as unknown as MouseEvent,
            'https://example.com/preview.mp3',
        )

        expect(audioPlayer.playSource).toHaveBeenCalledWith('https://example.com/preview.mp3', 0.25)
    })

    it('seeks an active track without restarting it', () => {
        const trackSeeker = document.createElement('button')
        jest.spyOn(trackSeeker, 'getBoundingClientRect').mockReturnValue({
            left: 40,
            width: 160,
        } as DOMRect)
        audioPlayer.currentUrl.set('https://example.com/preview.mp3')

        component.seekTrack(
            { currentTarget: trackSeeker, clientX: 160 } as unknown as MouseEvent,
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
