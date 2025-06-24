import { CommonModule } from '@angular/common'
import { Component, ElementRef, HostListener, inject, signal, viewChildren } from '@angular/core'
import { takeUntilDestroyed, toObservable, toSignal } from '@angular/core/rxjs-interop'
import { RouterLink } from '@angular/router'
import { TranslateModule } from '@ngx-translate/core'
import { mergeScan } from 'rxjs'
import { HydratedFeedItem } from '../../../app/feed/feed.backend.service'
import { ElectronService } from '../core/services'
import { WebAudioPlayer } from '../core/services/audio-player.service'
import { FeedService } from '../core/services/feed.service'
import { IntersectionDirective } from '../shared/directives/intersection.directive'
import { SafePipe } from '../shared/pipes/safe.pipe'
import { formatDateRelative, formatDuration } from '../shared/utils/formatting.utils'

@Component({
    selector: 'app-detail',
    templateUrl: './detail.component.html',
    styleUrls: ['./detail.component.css'],
    imports: [CommonModule, RouterLink, TranslateModule, SafePipe, IntersectionDirective],
})
export class DetailComponent {
    electronService = inject(ElectronService)
    feedService = inject(FeedService)
    audioPlayer = inject(WebAudioPlayer)

    feedEntries = viewChildren<ElementRef<HTMLElement>>('feedEntry')
    currentFeedIndex = signal(0)
    furthestScrolledIndex = signal(0)

    feed = toSignal(
        toObservable(this.furthestScrolledIndex).pipe(
            mergeScan(
                async (acc, furthestScrolledIndex) => {
                    const numPrefetchItems = 4
                    const lastLoadedItemIndex = (acc?.length || 0) - 1
                    const itemCountToFetch =
                        furthestScrolledIndex + numPrefetchItems - Math.max(lastLoadedItemIndex, 0)

                    const items = await this.feedService.loadFeed(lastLoadedItemIndex + 1, itemCountToFetch)

                    return (acc || []).concat(items)
                },
                null as HydratedFeedItem[] | null,
                1, // Max concurrent requests: ensures we don't run into race conditions
            ),
        ),
    )

    @HostListener('document:keydown.ArrowUp', ['$event'])
    @HostListener('document:keydown.K', ['$event'])
    onArrowUp(event: KeyboardEvent) {
        event.preventDefault()
        this.scrollUp()
    }
    scrollUp() {
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
    onArrowDown(event: KeyboardEvent) {
        event.preventDefault()
        this.scrollDown()
    }
    scrollDown() {
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
        if (!isIntersecting) return

        this.currentFeedIndex.set(index)
        this.furthestScrolledIndex.set(Math.max(this.furthestScrolledIndex(), index))

        // @TODO: Handle all feed item types

        const streamUrl = feedItem.data.tracks?.find(track => track.streamUrl)?.streamUrl
        if (!streamUrl) {
            console.warn('No stream URL found for release:', feedItem)
        } else {
            if (this.audioPlayer.currentUrl() == streamUrl) {
                // Already playing the track, don't restart it
            } else {
                this.audioPlayer.playSource(streamUrl)
                this.scrollCurrentTrackIntoView()
            }
        }

        // @TODO: Mark feed item as viewed when it comes into view (or wait for a delay)
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

        // @TODO: Handle all feed item types
        const currentFeedItem = this.feed()?.[this.currentFeedIndex()]?.data
        if (!currentFeedItem) {
            console.log('No current feed item')
            return
        }

        const currentPlayingTrackIndex = currentFeedItem.tracks.findIndex(
            track => track.streamUrl == this.audioPlayer.currentUrl(),
        )
        if (currentPlayingTrackIndex == -1) {
            console.log('No current playing track')
            return
        }
        const nextPlayableTrack = currentFeedItem.tracks.find(
            (track, index) => index > currentPlayingTrackIndex && !!track.streamUrl,
        )
        if (!nextPlayableTrack) {
            console.log('No next track to play, scrolling down')
            this.scrollDown()
            return
        }

        this.audioPlayer.playSource(nextPlayableTrack.streamUrl!)
        this.scrollCurrentTrackIntoView()
    }

    _autoPlayNextTrackSubscription = this.audioPlayer.ended$.pipe(takeUntilDestroyed()).subscribe(() => {
        this.nextTrack()
    })

    @HostListener('document:keydown.Shift.ArrowUp', ['$event'])
    @HostListener('document:keydown.Shift.K', ['$event'])
    prevTrack(event?: KeyboardEvent) {
        event?.preventDefault()

        // @TODO: Handle all feed item types
        const currentFeedItem = this.feed()?.[this.currentFeedIndex()]?.data
        if (!currentFeedItem) {
            console.warn('No current feed item')
            return
        }

        const currentPlayingTrackIndex = currentFeedItem.tracks.findIndex(
            track => track.streamUrl == this.audioPlayer.currentUrl(),
        )
        if (currentPlayingTrackIndex == -1) {
            console.log('No current playing track')
            return
        }

        let prevPlayableTrackIndex = -1
        for (let index = currentPlayingTrackIndex - 1; index >= 0; index--) {
            if (currentFeedItem.tracks[index]?.streamUrl) {
                prevPlayableTrackIndex = index
                break
            }
        }
        if (prevPlayableTrackIndex == -1) {
            console.log('No prev track to play, scrolling up')
            this.scrollUp()
            return
        }

        this.audioPlayer.playSource(currentFeedItem.tracks[prevPlayableTrackIndex]!.streamUrl!)
        this.scrollCurrentTrackIntoView()
    }

    @HostListener('document:keydown.O', ['$event'])
    openCurrentFeedItemInBrowser(event: KeyboardEvent) {
        event.preventDefault()

        // @TODO: Handle all feed item types
        const url = this.feed()?.[this.currentFeedIndex()]?.data.releaseUrl
        if (!url) {
            console.warn('No current release url')
            return
        }
        this.electronService.openUrl(url)
    }

    scrollCurrentTrackIntoView() {
        // @TODO: Handle all feed item types
        const currentFeedItem = this.feed()?.[this.currentFeedIndex()]?.data
        if (!currentFeedItem) {
            console.log('No current feed item')
            return
        }
        const currentPlayingTrackIndex = currentFeedItem.tracks.findIndex(
            track => track.streamUrl == this.audioPlayer.currentUrl(),
        )
        if (currentPlayingTrackIndex == -1) {
            console.log('No current playing track')
            return
        }
        const currentTrackElement = this.feedEntries()[this.currentFeedIndex()]?.nativeElement.querySelector(
            `.track[data-track-index="${currentPlayingTrackIndex}"]`,
        )

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
    }

    formatDuration = formatDuration
    formatDateRelative = formatDateRelative
}
