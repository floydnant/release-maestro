import { ComponentFixture, TestBed, waitForAsync } from '@angular/core/testing'
import { provideRouter } from '@angular/router'
import { provideTranslateService } from '@ngx-translate/core'
import { calendarDaySchema, HydratedFeedItem, ScrapedLinkMetadata } from '@release-maestro/core'
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

// jsdom has no IntersectionObserver; rendered releases need one for scroll tracking.
const stubIntersectionObserver = () =>
    Object.defineProperty(window, 'IntersectionObserver', {
        configurable: true,
        value: class {
            observe = jest.fn()
            disconnect = jest.fn()
        },
    })

const withPlayableTrack = (release: HydratedFeedItem, title: string): HydratedFeedItem => ({
    ...release,
    data: {
        ...release.data,
        tracks: [
            {
                title,
                id: null,
                artist: null,
                duration: 120,
                titleLink: null,
                albumPreorder: false,
                streamUrl: `https://example.com/${release.id}.mp3`,
                fans: [],
            },
        ],
    },
})

const failedToLoad = (release: HydratedFeedItem, error: { message: string; retryAt?: number }) => ({
    ...release,
    error,
})

const rateLimited = { userFacingMessage: 'Bandcamp is limiting requests. Try again in a minute.' }

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
        reloadFeedItems: jest.Mock<Promise<HydratedFeedItem[]>, [string[]]>
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
            reloadFeedItems: jest.fn().mockResolvedValue([]),
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
        stubIntersectionObserver()

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

    const renderFeed = async () => {
        const feedFixture = TestBed.createComponent(FeedComponent)
        const host = feedFixture.nativeElement as HTMLElement
        const settle = async () => {
            feedFixture.detectChanges()
            await feedFixture.whenStable()
            feedFixture.detectChanges()
        }
        await settle()
        return {
            feed: feedFixture.componentInstance,
            feedFixture,
            host,
            settle,
            text: () => host.textContent ?? '',
            entryFor: (releaseName: string) =>
                [...host.querySelectorAll<HTMLElement>('.feed-entry')].find(entry =>
                    entry.querySelector('.tralbum-title')?.textContent?.includes(releaseName),
                ),
            retryButton: () =>
                [...host.querySelectorAll('button')].find(button => button.textContent?.trim() === 'Retry'),
        }
    }

    describe('when loading releases fails', () => {
        beforeEach(() => {
            jest.spyOn(console, 'error').mockImplementation()
            stubIntersectionObserver()
            feedService.loadFeed.mockReset()
        })

        it('keeps loaded releases playable when the next page fails, and Retry loads it in place', async () => {
            const first = withPlayableTrack(createRelease('first', []), 'First Opener')
            const second = withPlayableTrack(createRelease('second', []), 'Second Opener')
            const third = withPlayableTrack(createRelease('third', []), 'Third Opener')
            feedService.loadFeed
                .mockResolvedValueOnce([first, second])
                .mockRejectedValueOnce(rateLimited)
                .mockResolvedValueOnce([third])
            const { feed, text, entryFor, retryButton, settle } = await renderFeed()
            const firstEntry = entryFor('first')
            expect(firstEntry).toBeDefined()

            // Scrolling to the second release prefetches the next page, which Bandcamp rate limits.
            feed.furthestScrolledIndex.set(1)
            await settle()

            expect(feedService.loadFeed).toHaveBeenCalledTimes(2)
            expect(text()).toContain(rateLimited.userFacingMessage)
            // The releases that already loaded stay on screen, as the same entries, and still play.
            expect(entryFor('first')).toBe(firstEntry)
            expect(entryFor('second')).toBeDefined()
            const playSecond = entryFor('second')?.querySelector<HTMLButtonElement>(
                'button[aria-label="Play Second Opener"]',
            )
            expect(playSecond).toBeTruthy()
            playSecond?.click()
            expect(audioPlayer.playSource).toHaveBeenCalledWith('https://example.com/second.mp3')

            // Retry fetches only the missing page, without leaving the feed.
            retryButton()?.click()
            await settle()

            expect(feedService.loadFeed).toHaveBeenCalledTimes(3)
            expect(feedService.loadFeed).toHaveBeenLastCalledWith(0, expect.any(Number), ['first', 'second'])
            expect(entryFor('first')).toBe(firstEntry)
            expect(entryFor('third')).toBeDefined()
            expect(text()).not.toContain(rateLimited.userFacingMessage)
            expect(retryButton()).toBeUndefined()
        })

        it('shows progress while retrying the first page and drops retries raised meanwhile', async () => {
            const release = createRelease('after-retry', [])
            let rejectRetry!: (error: unknown) => void
            feedService.loadFeed
                .mockRejectedValueOnce(rateLimited)
                .mockReturnValueOnce(new Promise((_resolve, reject) => (rejectRetry = reject)))
                .mockResolvedValueOnce([release])
            const { host, text, entryFor, retryButton, settle } = await renderFeed()

            expect(text()).toContain(rateLimited.userFacingMessage)
            const retry = retryButton()
            expect(retry).toBeDefined()

            retry?.click()
            await settle()

            // While the retry is in flight the page says so, and Retry cannot be pressed again.
            expect(feedService.loadFeed).toHaveBeenCalledTimes(2)
            expect(host.querySelector('[aria-busy="true"]')).not.toBeNull()
            expect(retryButton()?.disabled ?? true).toBe(true)
            retry?.click()
            window.dispatchEvent(new Event('online'))
            window.dispatchEvent(new Event('online'))
            await settle()

            rejectRetry(rateLimited)
            await settle()

            // The retry failed again; the reconnects raised during it were not replayed behind it.
            expect(feedService.loadFeed).toHaveBeenCalledTimes(2)
            expect(text()).toContain(rateLimited.userFacingMessage)

            retryButton()?.click()
            await settle()

            expect(entryFor('after-retry')).toBeDefined()
            expect(retryButton()).toBeUndefined()
            expect(feedService.loadFeed).toHaveBeenCalledTimes(3)
        })
    })

    describe('when a release fails to load', () => {
        beforeEach(() => {
            jest.spyOn(console, 'error').mockImplementation()
            jest.spyOn(console, 'warn').mockImplementation()
            stubIntersectionObserver()
        })

        it('never marks a failed release viewed, but marks it once it has loaded', async () => {
            const broken = failedToLoad(createRelease('broken', []), { message: 'Could not reach Bandcamp' })
            const healthy = createRelease('healthy', [])
            feedService.loadFeed.mockResolvedValueOnce([broken, healthy])
            feedService.reloadFeedItems.mockResolvedValueOnce([createRelease('broken', [])])
            const { feed, settle } = await renderFeed()

            feed.onIntersectionChange(true, broken, 0)
            feed.onIntersectionChange(false, broken, 0)
            feed.onIntersectionChange(true, healthy, 1)
            feed.onIntersectionChange(false, healthy, 1)

            expect(feedService.markFeedItemViewed.mock.calls).toEqual([
                ['healthy', 'BANDCAMP.TRALBUM', false],
            ])

            // Loaded again while in view, it counts as seen once the user moves past it.
            feed.onIntersectionChange(true, broken, 0)
            feed.itemRetry$.next(broken)
            await settle()
            const reloaded = feed.feedState()?.items[0]
            expect(reloaded?.error).toBeNull()
            if (reloaded) feed.onIntersectionChange(false, reloaded, 0)

            expect(feedService.markFeedItemViewed).toHaveBeenLastCalledWith(
                'broken',
                'BANDCAMP.TRALBUM',
                false,
            )
        })

        it('reloads one release in place from its Retry button, showing progress meanwhile', async () => {
            const first = withPlayableTrack(createRelease('first', []), 'First Opener')
            const broken = failedToLoad(createRelease('broken', []), { message: 'Could not reach Bandcamp' })
            let resolveReload!: (items: HydratedFeedItem[]) => void
            feedService.loadFeed.mockResolvedValueOnce([first, broken])
            feedService.reloadFeedItems.mockReturnValueOnce(new Promise(resolve => (resolveReload = resolve)))
            const { host, text, entryFor, settle } = await renderFeed()
            const firstEntry = entryFor('first')
            const brokenEntry = entryFor('broken')
            const retryBroken = () =>
                host.querySelector<HTMLButtonElement>('button[aria-label="Retry loading broken"]')

            retryBroken()?.click()
            await settle()

            expect(feedService.reloadFeedItems.mock.calls).toEqual([[['broken']]])
            expect(brokenEntry?.querySelector('.error')?.getAttribute('aria-busy')).toBe('true')
            expect(retryBroken()?.getAttribute('aria-disabled')).toBe('true')

            resolveReload([withPlayableTrack(createRelease('broken', []), 'Recovered Opener')])
            await settle()

            expect(text()).not.toContain('Could not reach Bandcamp')
            expect(entryFor('broken')).toBe(brokenEntry)
            expect(entryFor('first')).toBe(firstEntry)
            expect(brokenEntry?.querySelector('button[aria-label="Play Recovered Opener"]')).not.toBeNull()
            expect(feedService.reloadFeedItems).toHaveBeenCalledTimes(1)
        })

        describe('on a rate limit', () => {
            const now = new Date('2026-10-23T12:00:00.000Z').getTime()
            const retryAt = now + 60_000

            beforeEach(() => {
                jest.useFakeTimers({ now, doNotFake: ['queueMicrotask', 'nextTick'] })
            })
            afterEach(() => {
                jest.useRealTimers()
            })

            it('reloads the current release and the next five once, when the rate limit lifts', async () => {
                const coolingDown = (id: string) =>
                    failedToLoad(createRelease(id, []), { message: rateLimited.userFacingMessage, retryAt })
                const releases = [
                    createRelease('current', []),
                    coolingDown('soon'),
                    ...['third', 'fourth', 'fifth', 'sixth'].map(id => createRelease(id, [])),
                    coolingDown('far'),
                ]
                feedService.loadFeed.mockResolvedValueOnce(releases)
                let finishFirstReload!: (items: HydratedFeedItem[]) => void
                // Bandcamp is still limiting at the deadline: the release keeps the same deadline.
                feedService.reloadFeedItems
                    .mockReturnValueOnce(new Promise(resolve => (finishFirstReload = resolve)))
                    .mockImplementation(ids => Promise.resolve(ids.map(id => coolingDown(id))))
                const { feed, feedFixture, host, entryFor } = await renderFeed()
                const advance = async (ms: number) => {
                    await jest.advanceTimersByTimeAsync(ms)
                    feedFixture.detectChanges()
                    await jest.advanceTimersByTimeAsync(0)
                    feedFixture.detectChanges()
                }
                const rateLimitNote = (id: string) => entryFor(id)?.querySelector('.rate-limit')

                // A rate limit reads as a calm wait, not a failure: no red error, no Retry while it lasts.
                expect(rateLimitNote('soon')?.textContent).toContain('This release loads again at')
                expect(rateLimitNote('far')?.textContent).toContain('when it comes into view')
                expect(entryFor('soon')?.querySelector('.error, app-icon[name="error"]')).toBeNull()
                expect(host.textContent).not.toContain(rateLimited.userFacingMessage)
                expect(host.querySelector('button[aria-label="Retry loading soon"]')).toBeNull()

                await advance(59_999)
                expect(feedService.reloadFeedItems).not.toHaveBeenCalled()

                await advance(1)
                expect(feedService.reloadFeedItems.mock.calls).toEqual([[['soon']]])
                expect(rateLimitNote('soon')?.getAttribute('aria-busy')).toBe('true')
                expect(rateLimitNote('soon')?.textContent).toContain('Loading this release again')

                finishFirstReload([coolingDown('soon')])
                // The deadline was tried; the release now waits for its own Retry button.
                await advance(120_000)
                expect(feedService.reloadFeedItems).toHaveBeenCalledTimes(1)
                expect(host.querySelector('button[aria-label="Retry loading soon"]')).not.toBeNull()
                // Out of view, a passed deadline is not shown as a time in the past.
                expect(rateLimitNote('far')?.textContent).toContain('when it comes into view')

                // Scrolling brings the release past the window into it, and its passed deadline reloads it.
                feed.currentFeedIndex.set(2)
                await advance(0)
                expect(feedService.reloadFeedItems.mock.calls).toEqual([[['soon']], [['far']]])
            })

            it('skips an automatic reload that waited behind a page load while the release left the window', async () => {
                const cooling = failedToLoad(createRelease('cooling', []), {
                    message: rateLimited.userFacingMessage,
                    retryAt,
                })
                let finishNextPage!: (items: HydratedFeedItem[]) => void
                feedService.loadFeed
                    .mockReset()
                    .mockResolvedValueOnce([
                        createRelease('first', []),
                        cooling,
                        ...['third', 'fourth', 'fifth'].map(id => createRelease(id, [])),
                    ])
                    .mockReturnValueOnce(new Promise(resolve => (finishNextPage = resolve)))
                    .mockResolvedValue([])
                const { feed, feedFixture } = await renderFeed()
                const advance = async (ms: number) => {
                    await jest.advanceTimersByTimeAsync(ms)
                    feedFixture.detectChanges()
                    await jest.advanceTimersByTimeAsync(0)
                    feedFixture.detectChanges()
                }

                // Reaching the cooling release asks for the next page, which stays in flight.
                feed.currentFeedIndex.set(1)
                feed.furthestScrolledIndex.set(1)
                await advance(0)
                expect(feedService.loadFeed).toHaveBeenCalledTimes(2)

                // The deadline passes while the page loads, so its reload waits; then the user scrolls on.
                await advance(60_000)
                feed.currentFeedIndex.set(4)
                await advance(0)
                finishNextPage([])
                await advance(0)

                expect(feedService.reloadFeedItems).not.toHaveBeenCalled()

                // Back in the window, the release still reloads on its own.
                feed.currentFeedIndex.set(1)
                await advance(0)
                expect(feedService.reloadFeedItems.mock.calls).toEqual([[['cooling']]])
            })
        })
    })

    describe('timestamp line', () => {
        // Local wall-clock times, so the calendar days match in any timezone.
        const now = new Date('2026-10-23T12:00:00').getTime()

        beforeEach(() => {
            stubIntersectionObserver()
            jest.useFakeTimers({ now, doNotFake: ['queueMicrotask', 'nextTick'] })
        })
        afterEach(() => {
            jest.useRealTimers()
        })

        const dated = (
            release: HydratedFeedItem,
            releaseDate: string | null,
            emailReceivedAt: string,
            artist: string | null = 'Shiva Chandra',
        ): HydratedFeedItem => ({
            ...release,
            data: {
                ...release.data,
                artist,
                releaseDate: releaseDate === null ? null : calendarDaySchema.parse(releaseDate),
                emailReceivedAt: new Date(emailReceivedAt),
            },
        })

        /** What the line shows, without the spoken-only full dates, and what each timestamp says aloud. */
        const timestampLine = (entry: HTMLElement | undefined) => {
            const line = entry?.querySelector<HTMLElement>('.tralbum-title + p')
            if (!line) throw new Error('The release has no timestamp line')
            const normalize = (text: string | null) => (text ?? '').replace(/\s+/g, ' ').trim()
            const visible = line.cloneNode(true) as HTMLElement
            visible.querySelectorAll('.sr-only').forEach(spoken => spoken.remove())
            return {
                text: normalize(visible.textContent),
                emailIcon: line.querySelector('time.email-received app-icon[aria-hidden="true"]'),
                times: [...line.querySelectorAll('time')].map(time => ({
                    datetime: time.getAttribute('datetime'),
                    label: time.getAttribute('aria-label'),
                    shown: normalize(time.querySelector('span[aria-hidden="true"]')?.textContent ?? null),
                    spoken: normalize(time.querySelector('.sr-only')?.textContent ?? null),
                })),
            }
        }

        it('shows the release day, then when its email arrived, the same for every email kind', async () => {
            const purchase: HydratedFeedItem = {
                ...createRelease('purchased', []),
                sourceType: 'EMAIL.BANDCAMP_FANS_BOUGHT_MUSIC',
            }
            feedService.loadFeed.mockResolvedValue([
                dated(createRelease('past', []), '2026-10-07', '2026-10-03T10:00:00'),
                dated(createRelease('upcoming', []), '2026-10-30', '2026-10-21T10:00:00'),
                dated(createRelease('last-year', []), '2025-03-05', '2026-10-03T10:00:00'),
                dated(purchase, '2026-10-07', '2026-10-03T10:00:00'),
            ])
            const { entryFor } = await renderFeed()

            expect(timestampLine(entryFor('past')).text).toBe(
                'by Shiva Chandra • released Oct 7 (16d ago) • 20d ago',
            )
            expect(timestampLine(entryFor('upcoming')).text).toBe(
                'by Shiva Chandra • releases Oct 30 (in 7d) • 2d ago',
            )
            expect(timestampLine(entryFor('last-year')).text).toBe(
                'by Shiva Chandra • released Mar 5 2025 (1y ago) • 20d ago',
            )
            expect(timestampLine(entryFor('purchased')).text).toBe(
                'by Shiva Chandra • released Oct 7 (16d ago) • 20d ago',
            )

            // Each time speaks its full date, with the year and the time the email arrived, as its own
            // text rather than a name, which the time role prohibits.
            const past = timestampLine(entryFor('past'))
            expect(past.emailIcon).not.toBeNull()
            expect(past.times).toEqual([
                {
                    datetime: '2026-10-07',
                    label: null,
                    shown: 'released Oct 7 (16d ago)',
                    spoken: 'Release date: October 7, 2026',
                },
                {
                    datetime: new Date('2026-10-03T10:00:00').toISOString(),
                    label: null,
                    shown: '20d ago',
                    spoken: 'Email received: October 3, 2026, 10:00 AM',
                },
            ])
        })

        it('shows only when the email arrived for a release without a date or artist', async () => {
            feedService.loadFeed.mockResolvedValue([
                dated(createRelease('undated', []), null, '2026-10-23T08:00:00', null),
                dated(createRelease('undated-by-artist', []), null, '2026-10-22T08:00:00'),
            ])
            const { entryFor } = await renderFeed()

            expect(timestampLine(entryFor('undated')).text).toBe('today')
            expect(timestampLine(entryFor('undated-by-artist')).text).toBe('by Shiva Chandra • 1d ago')
            expect(timestampLine(entryFor('undated')).times).toEqual([
                {
                    datetime: new Date('2026-10-23T08:00:00').toISOString(),
                    label: null,
                    shown: 'today',
                    spoken: 'Email received: October 23, 2026, 8:00 AM',
                },
            ])
        })
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
