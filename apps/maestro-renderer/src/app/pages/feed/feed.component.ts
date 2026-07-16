import { CommonModule } from '@angular/common'
import {
    ChangeDetectionStrategy,
    Component,
    ElementRef,
    HostListener,
    inject,
    signal,
    viewChildren,
} from '@angular/core'
import { takeUntilDestroyed, toObservable, toSignal } from '@angular/core/rxjs-interop'
import { RouterModule } from '@angular/router'
import { TranslateModule } from '@ngx-translate/core'
import { assertUnreachable, HydratedFeedItem } from '@release-maestro/core'
import { combineLatestWith, fromEvent, mergeScan, mergeWith, startWith, Subject } from 'rxjs'
import { ElectronService } from '../../core/services'
import { WebAudioPlayer } from '../../core/services/audio-player.service'
import { FeedService } from '../../core/services/feed.service'
import { IconComponent } from '../../shared/components/icon/icon.component'
import { ProgressRingComponent } from '../../shared/components/progress-ring/progress-ring.component'
import { IntersectionDirective } from '../../shared/directives/intersection.directive'
import { SafePipe } from '../../shared/pipes/safe.pipe'
import { formatDateRelative, formatDuration } from '../../shared/utils/formatting.utils'

const NUM_PREFETCH_ITEMS = 5
const SEEK_BY_SECONDS = 30

const getUserFacingErrorMessage = (error: unknown) => {
    if (typeof error == 'string') return error
    if (typeof error == 'object' && error != null) {
        if ('userFacingMessage' in error) return String(error.userFacingMessage)
    }

    return undefined
}

type FeedState =
    | { status: 'feed'; items: HydratedFeedItem[] }
    | { status: 'caught-up'; items: [] }
    | { status: 'empty'; items: [] }
    | { status: 'error'; items: HydratedFeedItem[]; error: string }

@Component({
    selector: 'app-feed',
    templateUrl: './feed.component.html',
    styleUrls: ['./feed.component.css'],
    changeDetection: ChangeDetectionStrategy.OnPush,
    imports: [
        CommonModule,
        TranslateModule,
        SafePipe,
        IntersectionDirective,
        ProgressRingComponent,
        IconComponent,
        RouterModule,
    ],
})
export class FeedComponent {
    electronService = inject(ElectronService)
    feedService = inject(FeedService)
    audioPlayer = inject(WebAudioPlayer)

    feedEntries = viewChildren<ElementRef<HTMLElement>>('feedEntry')
    currentFeedIndex = signal(0)
    furthestScrolledIndex = signal(0)

    retryNotifier$ = new Subject<void>()

    loadedFeedItemIds = new Set<string>()
    feedState = toSignal(
        toObservable(this.furthestScrolledIndex).pipe(
            combineLatestWith(
                this.retryNotifier$.pipe(mergeWith(fromEvent(window, 'online')), startWith(null)),
            ),
            mergeScan(
                async (previousState, [furthestScrolledIndex]): Promise<FeedState> => {
                    const previousItems = previousState?.items ?? []
                    const lastLoadedItemIndex = previousItems.length - 1
                    const itemCountToFetch =
                        furthestScrolledIndex + NUM_PREFETCH_ITEMS - Math.max(lastLoadedItemIndex, 0)

                    try {
                        const items = await this.feedService.loadFeed(
                            lastLoadedItemIndex + 1,
                            itemCountToFetch,
                        )
                        const newItems = items.filter(item => !this.loadedFeedItemIds.has(item.id))
                        if (items.length != newItems.length) {
                            console.warn(
                                'Duplicate feed items detected:',
                                items.filter(item => this.loadedFeedItemIds.has(item.id)),
                            )
                        }
                        newItems.forEach(item => this.loadedFeedItemIds.add(item.id))

                        const allItems = previousItems.concat(newItems)
                        if (allItems.length > 0) return { status: 'feed', items: allItems }

                        return {
                            status: (await this.feedService.hasFeed()) ? 'caught-up' : 'empty',
                            items: [],
                        }
                    } catch (error) {
                        console.error('Error loading feed state', error)

                        return {
                            status: 'error',
                            items: previousItems,
                            error: getUserFacingErrorMessage(error) || 'Failed to load',
                        }
                    }
                },
                null as FeedState | null,
                1, // Max concurrent requests: ensures we don't run into race conditions
            ),
        ),
        { initialValue: null },
    )

    @HostListener('document:keydown.Shift.ArrowUp', ['$event'])
    @HostListener('document:keydown.Shift.K', ['$event'])
    scrollUp(event?: Event) {
        event?.preventDefault()

        const currentIndex = this.currentFeedIndex()
        if (currentIndex > 0) {
            this.currentFeedIndex.set(currentIndex - 1)
            const prevEntry = this.feedEntries()[currentIndex - 1]
            if (prevEntry) {
                prevEntry.nativeElement.scrollIntoView({ behavior: 'smooth', block: 'center' })
            }
        }
    }

    @HostListener('document:keydown.Shift.ArrowDown', ['$event'])
    @HostListener('document:keydown.Shift.J', ['$event'])
    scrollDown(event?: Event) {
        event?.preventDefault()

        const currentIndex = this.currentFeedIndex()
        if (currentIndex < this.getFeedItems().length - 1) {
            this.currentFeedIndex.set(currentIndex + 1)
            this.furthestScrolledIndex.set(Math.max(this.furthestScrolledIndex(), currentIndex + 1))
            const nextEntry = this.feedEntries()[currentIndex + 1]
            if (nextEntry) {
                nextEntry.nativeElement.scrollIntoView({ behavior: 'smooth', block: 'center' })
            }
        }
    }

    onIntersectionChange(isIntersecting: boolean, feedItem: HydratedFeedItem, index: number) {
        if (isIntersecting) {
            this.currentFeedIndex.set(index)
            this.furthestScrolledIndex.set(Math.max(this.furthestScrolledIndex(), index))
            this.viewedFeedItems.add(feedItem.id)

            if (feedItem.type == 'BANDCAMP.TRALBUM') {
                const streamUrl = feedItem.data.tracks?.find(track => track.streamUrl)?.streamUrl
                if (!streamUrl) {
                    console.warn('No stream URL found for release:', feedItem)
                } else {
                    // @TODO: also check if a different track but from the same feed item is playing
                    if (this.audioPlayer.currentUrl() == streamUrl) {
                        // Already playing the track, don't restart it
                    } else {
                        this.audioPlayer.playSource(streamUrl)
                        this.scrollCurrentTrackIntoView()
                    }
                }
            } else {
                assertUnreachable(feedItem.type, `Unhandled feed item type:`)
            }

            return
        }

        if (!this.viewedFeedItems.has(feedItem.id)) return

        // @TODO: Wait a bit before marking the feed item as viewed:
        // item must have been in the viewport for X ms
        // (bc user might scroll through the feed quickly)
        this.feedService
            .markFeedItemViewed(feedItem.id, feedItem.type, this.snoozedFeedItems.has(feedItem.id))
            .catch(err => console.error(`Failed to mark feed item ${feedItem.id} as viewed:`, err))
    }
    viewedFeedItems = new Set<string>()
    snoozedFeedItems = new Set<string>()

    @HostListener('document:keydown.S', ['$event'])
    toggleCurrentFeedItemSnoozedState(event?: Event) {
        event?.preventDefault()
        const currentFeedItem = this.getFeedItems()[this.currentFeedIndex()]
        if (!currentFeedItem) {
            console.warn('No current feed item to snooze')
            return
        }

        if (this.snoozedFeedItems.has(currentFeedItem.id)) {
            this.snoozedFeedItems.delete(currentFeedItem.id)
            return
        }
        this.snoozedFeedItems.add(currentFeedItem.id)
    }

    @HostListener('document:keydown.ArrowRight', ['$event'])
    @HostListener('document:keydown.L', ['$event'])
    seekBackward(event: Event) {
        event.preventDefault()
        this.audioPlayer.seekBy(SEEK_BY_SECONDS)
    }
    @HostListener('document:keydown.ArrowLeft', ['$event'])
    @HostListener('document:keydown.H', ['$event'])
    seekForward(event: Event) {
        event.preventDefault()
        this.audioPlayer.seekBy(-SEEK_BY_SECONDS)
    }

    @HostListener('document:keydown.Space', ['$event'])
    togglePlay(event: Event) {
        event.preventDefault()
        if (this.audioPlayer.isPlaying()) {
            this.audioPlayer.pause()
        } else {
            this.audioPlayer.play()
        }
    }

    toggleTrackPlayback(streamUrl: string) {
        if (this.audioPlayer.currentUrl() == streamUrl) {
            this.audioPlayer.togglePlay()
            return
        }

        this.audioPlayer.playSource(streamUrl)
        this.scrollCurrentTrackIntoView()
    }

    seekTrack(event: MouseEvent, streamUrl: string) {
        const trackSeeker = event.currentTarget as HTMLElement
        const { left, width } = trackSeeker.getBoundingClientRect()
        const seekPercent = width > 0 ? Math.min(Math.max((event.clientX - left) / width, 0), 1) : 0

        if (this.audioPlayer.currentUrl() == streamUrl) {
            this.audioPlayer.seekTo(seekPercent)
            return
        }

        this.audioPlayer.playSource(streamUrl, seekPercent)
        this.scrollCurrentTrackIntoView()
    }

    isCurrentTrack(streamUrl: string | null) {
        return streamUrl != null && streamUrl == this.audioPlayer.currentUrl()
    }

    trackProgress(streamUrl: string | null) {
        if (!this.isCurrentTrack(streamUrl)) return 0

        const duration = this.audioPlayer.duration()
        if (!Number.isFinite(duration) || duration <= 0) return 0

        return Math.min(Math.max((this.audioPlayer.playerTime() / duration) * 100, 0), 100)
    }

    @HostListener('document:keydown.ArrowDown', ['$event'])
    @HostListener('document:keydown.J', ['$event'])
    nextTrack(event?: Event) {
        event?.preventDefault()

        const currentFeedItem = this.getFeedItems()[this.currentFeedIndex()]
        if (!currentFeedItem) {
            console.log('No current feed item')
            return
        }
        if (currentFeedItem.type == 'BANDCAMP.TRALBUM') {
            const currentPlayingTrackIndex = currentFeedItem.data.tracks.findIndex(
                track => track.streamUrl == this.audioPlayer.currentUrl(),
            )
            if (currentPlayingTrackIndex == -1) {
                console.log('No current playing track')
                return
            }
            const nextPlayableTrack = currentFeedItem.data.tracks.find(
                (track, index) => index > currentPlayingTrackIndex && !!track.streamUrl,
            )
            if (!nextPlayableTrack) {
                console.log('No next track to play, scrolling down')
                this.scrollDown()
                return
            }

            this.audioPlayer.playSource(nextPlayableTrack.streamUrl!)
            this.scrollCurrentTrackIntoView()
        } else {
            assertUnreachable(currentFeedItem.type, `Unhandled feed item type:`)
        }
    }

    _autoPlayNextTrackSubscription = this.audioPlayer.ended$.pipe(takeUntilDestroyed()).subscribe(() => {
        this.nextTrack()
    })

    @HostListener('document:keydown.ArrowUp', ['$event'])
    @HostListener('document:keydown.K', ['$event'])
    prevTrack(event?: Event) {
        event?.preventDefault()

        const currentFeedItem = this.getFeedItems()[this.currentFeedIndex()]
        if (!currentFeedItem) {
            console.warn('No current feed item')
            return
        }
        if (currentFeedItem.type == 'BANDCAMP.TRALBUM') {
            const currentPlayingTrackIndex = currentFeedItem.data.tracks.findIndex(
                track => track.streamUrl == this.audioPlayer.currentUrl(),
            )
            if (currentPlayingTrackIndex == -1) {
                console.log('No current playing track')
                return
            }

            let prevPlayableTrackIndex = -1
            for (let index = currentPlayingTrackIndex - 1; index >= 0; index--) {
                if (currentFeedItem.data.tracks[index]?.streamUrl) {
                    prevPlayableTrackIndex = index
                    break
                }
            }
            if (prevPlayableTrackIndex == -1) {
                console.log('No prev track to play, scrolling up')
                this.scrollUp()
                return
            }

            this.audioPlayer.playSource(currentFeedItem.data.tracks[prevPlayableTrackIndex]!.streamUrl!)
            this.scrollCurrentTrackIntoView()
        } else {
            assertUnreachable(currentFeedItem.type, `Unhandled feed item type:`)
        }
    }

    @HostListener('document:keydown.O', ['$event'])
    openCurrentFeedItemInBrowser(event: Event) {
        event.preventDefault()

        const currentFeedItem = this.getFeedItems()[this.currentFeedIndex()]
        if (!currentFeedItem) {
            console.warn('No current feed item to open in browser')
            return
        }
        if (currentFeedItem.type == 'BANDCAMP.TRALBUM') {
            const url = currentFeedItem.data.releaseUrl
            if (!url) {
                console.warn('No current release url')
                return
            }
            this.electronService.openUrl(url).catch(err => {
                console.error('Failed to open url in browser:', err)
            })
        } else {
            assertUnreachable(currentFeedItem.type, `Unhandled feed item type:`)
        }
    }

    scrollCurrentTrackIntoView() {
        const currentFeedItem = this.getFeedItems()[this.currentFeedIndex()]
        if (!currentFeedItem) {
            console.log('No current feed item')
            return
        }
        if (currentFeedItem.type == 'BANDCAMP.TRALBUM') {
            const currentPlayingTrackIndex = currentFeedItem.data.tracks.findIndex(
                track => track.streamUrl == this.audioPlayer.currentUrl(),
            )
            if (currentPlayingTrackIndex == -1) {
                console.log('No current playing track')
                return
            }
            const currentTrackElement = this.feedEntries()[
                this.currentFeedIndex()
            ]?.nativeElement.querySelector(`.track[data-track-index="${currentPlayingTrackIndex}"]`)

            if (currentTrackElement) {
                setTimeout(() => {
                    const trackRect = currentTrackElement.getBoundingClientRect()
                    const parentRect = currentTrackElement?.parentElement?.getBoundingClientRect()
                    if (!parentRect) {
                        console.warn('Parent element not found for current track element')
                    }

                    const isVisible =
                        parentRect && trackRect.top >= parentRect.top && trackRect.bottom <= parentRect.bottom
                    if (!isVisible) {
                        currentTrackElement.scrollIntoView({ behavior: 'smooth', block: 'center' })
                    }
                }, 100)
            } else {
                console.warn('Current track element not found in the DOM')
            }
        } else {
            assertUnreachable(currentFeedItem.type, `Unhandled feed item type:`)
        }
    }

    private getFeedItems() {
        const feedState = this.feedState()
        return feedState?.status === 'feed' ? feedState.items : []
    }

    formatDuration = formatDuration
    formatDateRelative = formatDateRelative
    isInThePast = (date: Date) => {
        return new Date(date).getTime() < Date.now()
    }
    isAfter = (date: Date, otherDate: Date) => {
        return new Date(date).getTime() > new Date(otherDate).getTime()
    }
}
