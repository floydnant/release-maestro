import { CommonModule } from '@angular/common'
import {
    ChangeDetectionStrategy,
    Component,
    computed,
    ElementRef,
    HostListener,
    inject,
    Signal,
    signal,
    viewChildren,
} from '@angular/core'
import { takeUntilDestroyed, toObservable, toSignal } from '@angular/core/rxjs-interop'
import { RouterModule } from '@angular/router'
import {
    assertUnreachable,
    HydratedFeedItem,
    resolveFeedSettings,
    ScrapedLinkMetadata,
} from '@release-maestro/core'
import { HlmButtonImports } from '@spartan-ng/helm/button'
import { HlmTooltipImports } from '@spartan-ng/helm/tooltip'
import { HlmProgressImports } from '@spartan-ng/helm/progress'
import {
    catchError,
    concat,
    concatMap,
    defer,
    distinct,
    EMPTY,
    filter,
    from,
    fromEvent,
    map,
    merge,
    mergeMap,
    mergeScan,
    Observable,
    of,
    scan,
    Subject,
    switchMap,
    timer,
} from 'rxjs'
import { ElectronService } from '../../core/services'
import { WebAudioPlayer } from '../../core/services/audio-player.service'
import { SettingsService } from '../../core/settings/settings.service'
import { FeedService } from '../../core/services/feed.service'
import { IconComponent } from '../../shared/components/icon/icon.component'
import { ProgressRingComponent } from '../../shared/components/progress-ring/progress-ring.component'
import { IntersectionDirective } from '../../shared/directives/intersection.directive'
import { SafePipe } from '../../shared/pipes/safe.pipe'
import {
    formatCalendarDateRelative,
    formatDuration,
    formatReleaseDateRelative,
} from '../../shared/utils/formatting.utils'
import { settingsLink } from '../settings/settings-link'
import { FanAvatarStackComponent } from './fan-avatar-stack.component'
import { ReleaseLoadStatusComponent, ReleaseRecovery } from './release-load-status.component'

const NUM_PREFETCH_ITEMS = 5
/** Releases that failed on a rate limit reload on their own when current or among the next five. */
const AUTO_RETRY_WINDOW = 6
/** Most releases one reload request may ask for (see `reloadFeedItemsRequestSchema`). */
const MAX_RELOAD_BATCH = 20
const SEEK_BY_SECONDS = 30

const getUserFacingErrorMessage = (error: unknown) => {
    if (typeof error == 'string') return error
    if (typeof error == 'object' && error != null) {
        if ('userFacingMessage' in error) return String(error.userFacingMessage)
    }

    return undefined
}

type PageFailure = { message: string }

type FeedState = {
    items: HydratedFeedItem[]
    /** Why there are no releases to show, once a page load has come back empty. */
    emptyReason: 'caught-up' | 'not-set-up' | null
    /** The last page load failed. Loaded releases stay; the next page waits for Retry or reconnecting. */
    pageFailure: PageFailure | null
    isRetryingPage: boolean
    /** Failed releases being loaded again. */
    reloadingIds: ReadonlySet<string>
    /** The rate-limit deadline each release was last reloaded for automatically; each one is tried once. */
    autoRetriedDeadlines: ReadonlyMap<string, number>
}

const INITIAL_FEED_STATE: FeedState = {
    items: [],
    emptyReason: null,
    pageFailure: null,
    isRetryingPage: false,
    reloadingIds: new Set(),
    autoRetriedDeadlines: new Map(),
}

type FeedAction =
    | { kind: 'load-page'; furthestScrolledIndex: number; onlyWhenEmpty: boolean }
    /** Retries the failure that was on screen; a retry for a failure already handled does nothing. */
    | { kind: 'retry-page'; failure: PageFailure | null }
    /** Reloads these releases if they are still the same failed releases the action was raised for. */
    | { kind: 'reload-items'; items: HydratedFeedItem[]; isAutomatic: boolean }

type AutoRetry = { deadline: number; items: HydratedFeedItem[] }

const isSameAutoRetry = (a: AutoRetry | null, b: AutoRetry | null) =>
    a === b ||
    (a !== null &&
        b !== null &&
        a.deadline === b.deadline &&
        a.items.length === b.items.length &&
        a.items.every((item, index) => item === b.items[index]))

const recordAutoRetry = (deadlines: ReadonlyMap<string, number>, items: HydratedFeedItem[]) => {
    const next = new Map(deadlines)
    for (const item of items) {
        if (item.error?.retryAt != null) next.set(item.id, item.error.retryAt)
    }
    return next
}

const autoRetriedBefore = (state: FeedState, item: HydratedFeedItem) => {
    const retryAt = item.error?.retryAt
    return retryAt == null || (state.autoRetriedDeadlines.get(item.id) ?? -Infinity) >= retryAt
}

@Component({
    selector: 'app-feed',
    templateUrl: './feed.component.html',
    host: { class: 'flex min-h-0 w-full' },
    changeDetection: ChangeDetectionStrategy.OnPush,
    imports: [
        CommonModule,
        SafePipe,
        IntersectionDirective,
        ProgressRingComponent,
        IconComponent,
        RouterModule,
        HlmButtonImports,
        FanAvatarStackComponent,
        ReleaseLoadStatusComponent,
        HlmTooltipImports,
        HlmProgressImports,
    ],
})
export class FeedComponent {
    electronService = inject(ElectronService)
    feedService = inject(FeedService)
    audioPlayer = inject(WebAudioPlayer)
    readonly settingsLink = settingsLink
    private readonly settingsService = inject(SettingsService)
    /** How long a snoozed release stays away, from Settings → Feed. */
    private readonly snoozeDuration = computed(() => {
        const settings = this.settingsService.settings
        const { snoozeHours: hours } = resolveFeedSettings(
            settings.hasValue() ? settings.value()?.feed : undefined,
        )
        return hours === 1 ? '1 hour' : `${hours} hours`
    })
    readonly snoozeHint = computed(() => `Snooze: show this release again in ${this.snoozeDuration()}`)
    readonly unsnoozeHint = computed(
        () => `Snoozed for ${this.snoozeDuration()}. Unsnooze so it does not come back.`,
    )
    readonly playbackProgressLabel = (value: number, max: number) =>
        `${formatDuration(value)} of ${formatDuration(max)}`

    feedEntries = viewChildren<ElementRef<HTMLElement>>('feedEntry')
    currentFeedIndex = signal(0)
    furthestScrolledIndex = signal(0)

    readonly pageRetry$ = new Subject<void>()
    readonly itemRetry$ = new Subject<HydratedFeedItem>()

    loadedFeedItemIds = new Set<string>()

    /**
     * Failed releases due to reload when Bandcamp's rate limit lifts: those in the current window that
     * carry a deadline not yet tried. Releases sharing the earliest deadline go together in one batch.
     */
    private readonly autoRetryDue: Signal<AutoRetry | null> = computed(
        () => {
            const state = this.feedState()
            if (!state) return null

            const waiting = state.items
                .filter((_item, index) => this.isInAutoRetryWindow(index))
                .flatMap(item =>
                    item.error?.retryAt != null &&
                    !state.reloadingIds.has(item.id) &&
                    !autoRetriedBefore(state, item)
                        ? [{ item, retryAt: item.error.retryAt }]
                        : [],
                )
            if (waiting.length == 0) return null

            const deadline = Math.min(...waiting.map(({ retryAt }) => retryAt))
            return {
                deadline,
                items: waiting.filter(({ retryAt }) => retryAt <= deadline).map(({ item }) => item),
            }
        },
        { equal: isSameAutoRetry },
    )

    /**
     * Every change to the feed runs through one serial pipeline, so a page load, a retry and a release
     * reload never race over the same state. Retries carry what they were raised for, which drops
     * repeated clicks and reconnect bursts instead of queueing them.
     */
    readonly feedState: Signal<FeedState | null> = toSignal(
        merge(
            toObservable(this.furthestScrolledIndex).pipe(
                map((furthestScrolledIndex): FeedAction => ({
                    kind: 'load-page',
                    furthestScrolledIndex,
                    onlyWhenEmpty: false,
                })),
            ),
            this.feedService.emailImportProgress$.pipe(
                filter(update => update.phase === 'completed' && update.newlyImported > 0),
                map((): FeedAction => ({
                    kind: 'load-page',
                    furthestScrolledIndex: this.furthestScrolledIndex(),
                    onlyWhenEmpty: true,
                })),
            ),
            merge(this.pageRetry$, fromEvent(window, 'online')).pipe(
                map((): FeedAction => ({
                    kind: 'retry-page',
                    failure: this.feedState()?.pageFailure ?? null,
                })),
            ),
            this.itemRetry$.pipe(
                map((item): FeedAction => ({ kind: 'reload-items', items: [item], isAutomatic: false })),
            ),
            toObservable(this.autoRetryDue).pipe(
                switchMap(due =>
                    due
                        ? timer(Math.max(due.deadline - Date.now(), 0)).pipe(
                              map((): FeedAction => ({
                                  kind: 'reload-items',
                                  items: due.items,
                                  isAutomatic: true,
                              })),
                          )
                        : EMPTY,
                ),
            ),
        ).pipe(
            mergeScan(
                (state: FeedState | null, action: FeedAction) => this.applyFeedAction(state, action),
                null,
                1, // Max concurrent requests: ensures we don't run into race conditions
            ),
        ),
        { initialValue: null },
    )

    private applyFeedAction(state: FeedState | null, action: FeedAction): Observable<FeedState> {
        switch (action.kind) {
            case 'load-page': {
                // After a failure, the next page waits for Retry rather than failing again on every scroll.
                if (state?.pageFailure) return EMPTY
                if (action.onlyWhenEmpty && (!state || state.items.length > 0)) return EMPTY

                return defer(() => this.loadPage(state ?? INITIAL_FEED_STATE, action.furthestScrolledIndex))
            }
            case 'retry-page': {
                if (!state?.pageFailure || state.pageFailure !== action.failure) return EMPTY

                const retrying: FeedState = { ...state, isRetryingPage: true }
                return concat(
                    of(retrying),
                    defer(() => this.loadPage(retrying, this.furthestScrolledIndex())),
                )
            }
            case 'reload-items': {
                if (!state) return EMPTY

                const currentItems = new Map(state.items.map(item => [item.id, item]))
                const items = action.items
                    .filter(
                        item =>
                            item.error &&
                            currentItems.get(item.id) === item &&
                            !state.reloadingIds.has(item.id) &&
                            // Automatic retries may wait behind a page load while the user scrolls.
                            (!action.isAutomatic ||
                                (!autoRetriedBefore(state, item) &&
                                    this.isInAutoRetryWindow(state.items.indexOf(item)))),
                    )
                    .slice(0, MAX_RELOAD_BATCH)
                if (items.length == 0) return EMPTY

                const reloading: FeedState = {
                    ...state,
                    reloadingIds: new Set(items.map(item => item.id)),
                    autoRetriedDeadlines: action.isAutomatic
                        ? recordAutoRetry(state.autoRetriedDeadlines, items)
                        : state.autoRetriedDeadlines,
                }
                return concat(
                    of(reloading),
                    defer(() => this.reloadItems(reloading)),
                )
            }
            default:
                return assertUnreachable(action)
        }
    }

    private async loadPage(state: FeedState, furthestScrolledIndex: number): Promise<FeedState> {
        const previousItems = state.items
        const lastLoadedItemIndex = previousItems.length - 1
        const itemCountToFetch = furthestScrolledIndex + NUM_PREFETCH_ITEMS - Math.max(lastLoadedItemIndex, 0)

        try {
            const items = await this.feedService.loadFeed(0, itemCountToFetch, [...this.loadedFeedItemIds])
            const newItems = items.filter(item => !this.loadedFeedItemIds.has(item.id))
            if (items.length != newItems.length) {
                console.warn(
                    'Duplicate feed items detected:',
                    items.filter(item => this.loadedFeedItemIds.has(item.id)),
                )
            }
            newItems.forEach(item => this.loadedFeedItemIds.add(item.id))

            const loaded = { ...state, pageFailure: null, isRetryingPage: false }
            // Keep the same list when nothing was added, so rendered releases are left alone.
            const allItems = newItems.length > 0 ? previousItems.concat(newItems) : previousItems
            if (allItems.length > 0) return { ...loaded, items: allItems, emptyReason: null }

            return {
                ...loaded,
                items: allItems,
                emptyReason: (await this.feedService.hasFeed()) ? 'caught-up' : 'not-set-up',
            }
        } catch (error) {
            console.error('Error loading feed state', error)

            return {
                ...state,
                isRetryingPage: false,
                pageFailure: { message: getUserFacingErrorMessage(error) || 'Failed to load' },
            }
        }
    }

    /** Swaps each reloaded release in by ID, so its entry and every other release stay where they are. */
    private async reloadItems(state: FeedState): Promise<FeedState> {
        const ids = [...state.reloadingIds]
        const reloaded = await this.feedService.reloadFeedItems(ids).then(
            items => new Map(items.map(item => [item.id, item])),
            (error: unknown) => {
                console.error('Error reloading releases', ids, error)
                const failure = { message: getUserFacingErrorMessage(error) || 'Failed to load' }
                return new Map(
                    state.items
                        .filter(item => state.reloadingIds.has(item.id))
                        .map(item => [item.id, { ...item, error: failure }]),
                )
            },
        )

        return {
            ...state,
            reloadingIds: new Set(),
            items: state.items.map(item =>
                state.reloadingIds.has(item.id) ? (reloaded.get(item.id) ?? item) : item,
            ),
        }
    }

    releaseRecovery(state: FeedState, item: HydratedFeedItem, index: number): ReleaseRecovery {
        if (state.reloadingIds.has(item.id)) return 'reloading'
        if (autoRetriedBefore(state, item)) return 'manual'
        if (!this.isInAutoRetryWindow(index)) return 'when-in-view'
        // A passed deadline in the window reloads at once; say so rather than show a time already gone.
        return (item.error?.retryAt ?? 0) > Date.now() ? 'scheduled' : 'reloading'
    }

    private isInAutoRetryWindow(index: number) {
        const start = this.currentFeedIndex()
        return index >= start && index < start + AUTO_RETRY_WINDOW
    }

    /**
     * Link previews for loaded releases, keyed by URL. They load after the releases render, one
     * release at a time in feed order, so the first release fills in before later ones are fetched.
     * Each URL is requested once per visit; the backend caches previews across visits.
     */
    readonly linkPreviews: Signal<Record<string, ScrapedLinkMetadata>> = toSignal(
        toObservable(this.feedState).pipe(
            mergeMap(state => from(state?.items ?? [])),
            // A reloaded release is a new object and may bring links the failed one lacked.
            distinct(),
            scan(
                (
                    { requested }: { requested: ReadonlySet<string>; urls: string[] },
                    item: HydratedFeedItem,
                ) => {
                    const urls = [...new Set(item.data.links.map(link => link.url))].filter(
                        url => !requested.has(url),
                    )
                    return { requested: new Set([...requested, ...urls]), urls }
                },
                { requested: new Set<string>(), urls: [] },
            ),
            map(({ urls }) => urls),
            filter(urls => urls.length > 0),
            concatMap(urls =>
                from(this.feedService.loadLinkPreviews(urls)).pipe(
                    catchError((error: unknown) => {
                        console.warn('Failed to load link previews', urls, error)
                        return of({})
                    }),
                ),
            ),
            scan(
                (
                    previews: Record<string, ScrapedLinkMetadata>,
                    batch: Record<string, ScrapedLinkMetadata>,
                ) => ({ ...previews, ...batch }),
                {},
            ),
        ),
        { initialValue: {} },
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
        // A release that failed to load was never really seen. Leave it in the feed so it can load again.
        if (feedItem.error) return

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
        return this.feedState()?.items ?? []
    }

    formatDuration = formatDuration
    formatCalendarDateRelative = formatCalendarDateRelative
    formatReleaseDateRelative = formatReleaseDateRelative
    isAfter = (date: Date, otherDate: Date) => {
        return new Date(date).getTime() > new Date(otherDate).getTime()
    }
}
