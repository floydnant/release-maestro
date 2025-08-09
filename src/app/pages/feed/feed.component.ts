import { CommonModule } from '@angular/common'
import { Component, ElementRef, HostListener, inject, signal, viewChildren } from '@angular/core'
import { takeUntilDestroyed, toObservable, toSignal } from '@angular/core/rxjs-interop'
import { TranslateModule } from '@ngx-translate/core'
import { mergeScan } from 'rxjs'
import { HydratedFeedItem } from '../../../../app/feed/feed.schema'
import { ElectronService } from '../../core/services'
import { WebAudioPlayer } from '../../core/services/audio-player.service'
import { FeedService } from '../../core/services/feed.service'
import { IconComponent } from '../../shared/components/icon/icon.component'
import { ProgressRingComponent } from '../../shared/components/progress-ring/progress-ring.component'
import { IntersectionDirective } from '../../shared/directives/intersection.directive'
import { SafePipe } from '../../shared/pipes/safe.pipe'
import { formatDateRelative, formatDuration } from '../../shared/utils/formatting.utils'
import { assertUnreachable } from '../../shared/utils/type-guards.utils'

const getErrorMessage = (error: unknown) => {
    if (typeof error == 'string') return error
    if (typeof error == 'object' && error != null) {
        if ('userFacingMessage' in error) return String(error.userFacingMessage)
    }

    return undefined
}

@Component({
    selector: 'app-feed',
    templateUrl: './feed.component.html',
    styleUrls: ['./feed.component.css'],
    imports: [
        CommonModule,
        TranslateModule,
        SafePipe,
        IntersectionDirective,
        ProgressRingComponent,
        IconComponent,
    ],
})
export class FeedComponent {
    electronService = inject(ElectronService)
    feedService = inject(FeedService)
    audioPlayer = inject(WebAudioPlayer)

    feedEntries = viewChildren<ElementRef<HTMLElement>>('feedEntry')
    currentFeedIndex = signal(0)
    furthestScrolledIndex = signal(0)

    loadedFeedItemIds = new Set<string>()
    feedError = signal<null | string>(null)
    feed = toSignal(
        toObservable(this.furthestScrolledIndex).pipe(
            mergeScan(
                async (acc, furthestScrolledIndex) => {
                    const numPrefetchItems = 5
                    const lastLoadedItemIndex = (acc?.length || 0) - 1
                    const itemCountToFetch =
                        furthestScrolledIndex + numPrefetchItems - Math.max(lastLoadedItemIndex, 0)

                    const items = await this.feedService
                        .loadFeed(lastLoadedItemIndex + 1, itemCountToFetch)
                        .catch(err => {
                            console.error(err)

                            this.feedError.set(getErrorMessage(err) || 'Failed to load')
                            return null
                        })
                    if (!items) return null

                    const newItems = items.filter(item => !this.loadedFeedItemIds.has(item.id))
                    if (items.length != newItems.length) {
                        console.warn(
                            'Duplicate feed items detected:',
                            items.filter(item => this.loadedFeedItemIds.has(item.id)),
                        )
                    }
                    newItems.forEach(item => this.loadedFeedItemIds.add(item.id))

                    return (acc || []).concat(newItems)
                },
                null as HydratedFeedItem[] | null,
                1, // Max concurrent requests: ensures we don't run into race conditions
            ),
        ),
    )

    @HostListener('document:keydown.ArrowUp', ['$event'])
    @HostListener('document:keydown.K', ['$event'])
    scrollUp(event?: KeyboardEvent) {
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

    @HostListener('document:keydown.ArrowDown', ['$event'])
    @HostListener('document:keydown.J', ['$event'])
    scrollDown(event?: KeyboardEvent) {
        event?.preventDefault()

        const currentIndex = this.currentFeedIndex()
        if (currentIndex < (this.feed()?.length || 0) - 1) {
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
                assertUnreachable(feedItem.type, `Unhandled feed item type: ${feedItem.type}`)
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
    toggleCurrentFeedItemSnoozedState(event?: KeyboardEvent) {
        event?.preventDefault()
        const currentFeedItem = this.feed()?.[this.currentFeedIndex()]
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
    seekBackward(event: KeyboardEvent) {
        event.preventDefault()
        this.audioPlayer.seekBy(15)
    }
    @HostListener('document:keydown.ArrowLeft', ['$event'])
    @HostListener('document:keydown.H', ['$event'])
    seekForward(event: KeyboardEvent) {
        event.preventDefault()
        this.audioPlayer.seekBy(-15)
    }

    @HostListener('document:keydown.Space', ['$event'])
    togglePlay(event: KeyboardEvent) {
        event.preventDefault()
        if (this.audioPlayer.isPlaying()) {
            this.audioPlayer.pause()
        } else {
            this.audioPlayer.play()
        }
    }

    @HostListener('document:keydown.Shift.ArrowDown', ['$event'])
    @HostListener('document:keydown.Shift.J', ['$event'])
    nextTrack(event?: KeyboardEvent) {
        event?.preventDefault()

        const currentFeedItem = this.feed()?.[this.currentFeedIndex()]
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
            assertUnreachable(currentFeedItem.type, `Unhandled feed item type: ${currentFeedItem.type}`)
        }
    }

    _autoPlayNextTrackSubscription = this.audioPlayer.ended$.pipe(takeUntilDestroyed()).subscribe(() => {
        this.nextTrack()
    })

    @HostListener('document:keydown.Shift.ArrowUp', ['$event'])
    @HostListener('document:keydown.Shift.K', ['$event'])
    prevTrack(event?: KeyboardEvent) {
        event?.preventDefault()

        const currentFeedItem = this.feed()?.[this.currentFeedIndex()]
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
            assertUnreachable(currentFeedItem.type, `Unhandled feed item type: ${currentFeedItem.type}`)
        }
    }

    @HostListener('document:keydown.O', ['$event'])
    openCurrentFeedItemInBrowser(event: KeyboardEvent) {
        event.preventDefault()

        const currentFeedItem = this.feed()?.[this.currentFeedIndex()]
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
            this.electronService.openUrl(url)
        } else {
            assertUnreachable(currentFeedItem.type, `Unhandled feed item type: ${currentFeedItem.type}`)
        }
    }

    scrollCurrentTrackIntoView() {
        const currentFeedItem = this.feed()?.[this.currentFeedIndex()]
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
            assertUnreachable(currentFeedItem.type, `Unhandled feed item type: ${currentFeedItem.type}`)
        }
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
