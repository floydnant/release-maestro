import { CommonModule } from '@angular/common'
import {
    Component,
    computed,
    ElementRef,
    HostListener,
    inject,
    resource,
    signal,
    viewChildren,
} from '@angular/core'
import { takeUntilDestroyed, toObservable, toSignal } from '@angular/core/rxjs-interop'
import { RouterLink } from '@angular/router'
import { TranslateModule } from '@ngx-translate/core'
import { combineLatest, mergeScan } from 'rxjs'
import { ElectronService } from '../core/services'
import { WebAudioPlayer } from '../core/services/audio-player.service'
import { BandcampService } from '../core/services/bandcamp.service'
import {
    BandcampRelease,
    EmailService,
    mapBandcampEmailAndDataToRelease,
} from '../core/services/email.service'
import { IntersectionDirective } from '../shared/directives/intersection.directive'
import { SafePipe } from '../shared/pipes/safe.pipe'
import { formatDateRelative, formatDuration } from '../shared/utils/formatting.utils'
import { fulfilledOrNull } from '../shared/utils/object.utils'

@Component({
    selector: 'app-detail',
    templateUrl: './detail.component.html',
    styleUrls: ['./detail.component.css'],
    imports: [CommonModule, RouterLink, TranslateModule, SafePipe, IntersectionDirective],
})
export class DetailComponent {
    electronService = inject(ElectronService)
    emailService = inject(EmailService)
    bandcampService = inject(BandcampService)
    audioPlayer = inject(WebAudioPlayer)

    bandcampEmailsResource = resource({
        loader: () => this.emailService.loadEmails(),
    })
    unreadEmailsCount = computed(() => {
        let count = 0
        for (const email of this.bandcampEmailsResource.value() || []) {
            if (!email.isRead) {
                count++
            }
        }
        return count
    })

    feedEntries = viewChildren<ElementRef<HTMLElement>>('feedEntry')
    currentReleaseIndex = signal(0)
    furthestScrolledIndex = signal(0)

    bandcampReleases = toSignal(
        combineLatest([
            toObservable(this.bandcampEmailsResource.value),
            toObservable(this.furthestScrolledIndex),
        ]).pipe(
            mergeScan(
                async (acc, [emails, furthestScrolledIndex]) => {
                    if (!emails?.length) {
                        return null as BandcampRelease[] | null
                    }

                    const numPrefetchItems = 4
                    const emailsToLoadNow = emails
                        .slice(furthestScrolledIndex, furthestScrolledIndex + numPrefetchItems)
                        .filter(email => !acc?.find(e => e.emailId == email.messageId))
                    console.log(
                        'Loading:',
                        emailsToLoadNow.map(e => e.subject),
                    )

                    const promises = emailsToLoadNow.map(async email => {
                        const releaseUrl = email.musicLinks?.[0]
                        if (!releaseUrl) {
                            console.warn('No music link found for email:', email)

                            return mapBandcampEmailAndDataToRelease(email, null, null)
                        } else {
                            const labelUrl = releaseUrl.match(/https?:\/\/[\w-]+\.bandcamp\.com/)?.[0]

                            const [releaseData, labelData] = await Promise.allSettled([
                                this.bandcampService.fetchRelease(releaseUrl),
                                labelUrl ? this.bandcampService.fetchLabel(labelUrl) : null,
                            ])

                            return mapBandcampEmailAndDataToRelease(
                                email,
                                fulfilledOrNull(releaseData),
                                fulfilledOrNull(labelData),
                            )
                        }
                    })
                    const releases = await Promise.all(promises)
                    console.log('Loaded')

                    return (acc || []).concat(releases)
                },
                null as BandcampRelease[] | null,
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
        const currentIndex = this.currentReleaseIndex()
        if (currentIndex > 0) {
            this.currentReleaseIndex.set(currentIndex - 1)
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
        const currentIndex = this.currentReleaseIndex()
        if (currentIndex < (this.bandcampEmailsResource.value()?.length || 0) - 1) {
            this.currentReleaseIndex.set(currentIndex + 1)
            this.furthestScrolledIndex.set(Math.max(this.furthestScrolledIndex(), currentIndex + 1))
            const nextEntry = this.feedEntries()[currentIndex + 1]
            if (nextEntry) {
                nextEntry.nativeElement.scrollIntoView({ behavior: 'smooth', block: 'center' })
            }
        }
    }

    onIntersectionChange(isIntersecting: boolean, release: BandcampRelease, index: number) {
        if (!isIntersecting) return

        this.currentReleaseIndex.set(index)
        this.furthestScrolledIndex.set(Math.max(this.furthestScrolledIndex(), index))

        const streamUrl = release.tracks?.find(track => track.streamUrl)?.streamUrl
        if (!streamUrl) {
            console.warn('No stream URL found for release:', release)
        } else {
            if (this.audioPlayer.currentUrl() == streamUrl) {
                // Already playing the track, don't restart it
            } else {
                this.audioPlayer.playSource(streamUrl)
                this.scrollCurrentTrackIntoView()
            }
        }

        // @TODO: Mark email as read when it comes into view (or wait for a delay)
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

        const currentRelease = this.bandcampReleases()?.[this.currentReleaseIndex()]
        if (!currentRelease) {
            console.log('No current release')
            return
        }

        const currentPlayingTrackIndex = currentRelease.tracks.findIndex(
            track => track.streamUrl == this.audioPlayer.currentUrl(),
        )
        if (currentPlayingTrackIndex == -1) {
            console.log('No current playing track')
            return
        }
        const nextPlayableTrack = currentRelease.tracks.find(
            (track, index) => index > currentPlayingTrackIndex && !!track.streamUrl,
        )
        if (!nextPlayableTrack) {
            console.log('No next track to play, scrolling down')
            this.scrollDown()
            return
        }

        this.scrollCurrentTrackIntoView()
        this.audioPlayer.playSource(nextPlayableTrack.streamUrl!)
    }

    _autoPlayNextTrackSubscription = this.audioPlayer.ended$.pipe(takeUntilDestroyed()).subscribe(() => {
        this.nextTrack()
    })

    @HostListener('document:keydown.Shift.ArrowUp', ['$event'])
    @HostListener('document:keydown.Shift.K', ['$event'])
    prevTrack(event?: KeyboardEvent) {
        event?.preventDefault()

        const currentRelease = this.bandcampReleases()?.[this.currentReleaseIndex()]
        if (!currentRelease) {
            console.warn('No current release')
            return
        }

        const currentPlayingTrackIndex = currentRelease.tracks.findIndex(
            track => track.streamUrl == this.audioPlayer.currentUrl(),
        )
        if (currentPlayingTrackIndex == -1) {
            console.log('No current playing track')
            return
        }

        let prevPlayableTrackIndex = -1
        for (let index = currentPlayingTrackIndex - 1; index >= 0; index--) {
            if (currentRelease.tracks[index]?.streamUrl) {
                prevPlayableTrackIndex = index
                break
            }
        }
        if (prevPlayableTrackIndex == -1) {
            console.log('No prev track to play, scrolling up')
            this.scrollUp()
            return
        }

        this.scrollCurrentTrackIntoView()
        this.audioPlayer.playSource(currentRelease.tracks[prevPlayableTrackIndex]!.streamUrl!)
    }

    @HostListener('document:keydown.O', ['$event'])
    openReleaseInBrowser(event: KeyboardEvent) {
        event.preventDefault()

        const url = this.bandcampReleases()?.[this.currentReleaseIndex()]?.releaseUrl
        if (!url) {
            console.warn('No current release url')
            return
        }
        this.electronService.openUrl(url)
    }

    scrollCurrentTrackIntoView() {
        const currentRelease = this.bandcampReleases()?.[this.currentReleaseIndex()]
        if (!currentRelease) {
            console.log('No current release')
            return
        }
        const currentPlayingTrackIndex = currentRelease.tracks.findIndex(
            track => track.streamUrl == this.audioPlayer.currentUrl(),
        )
        if (currentPlayingTrackIndex == -1) {
            console.log('No current playing track')
            return
        }
        const currentTrackElement = this.feedEntries()[
            this.currentReleaseIndex()
        ]?.nativeElement.querySelector(`.track[data-track-index="${currentPlayingTrackIndex}"]`)
        if (currentTrackElement) {
            setTimeout(() => {
                currentTrackElement.scrollIntoView({ behavior: 'smooth', block: 'center' })
            })
        } else {
            console.warn('Current track element not found in the DOM')
        }
    }

    formatDuration = formatDuration
    formatDateRelative = formatDateRelative
}
