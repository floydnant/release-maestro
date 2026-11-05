import { HydratedFeedItem } from '@release-maestro/core'
import { ReleaseRecovery } from './release-load-status.component'

/** Releases that failed on a rate limit reload on their own when current or among the next five. */
const AUTO_RETRY_WINDOW = 6
/** Most releases one reload request may ask for (see `reloadFeedItemsRequestSchema`). */
const MAX_RELOAD_BATCH = 20

export type PageFailure = { message: string }

/** What the feed page shows. Only the feed's serial action pipeline produces a new state. */
export type FeedState = {
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

export const INITIAL_FEED_STATE: FeedState = {
    items: [],
    emptyReason: null,
    pageFailure: null,
    isRetryingPage: false,
    reloadingIds: new Set(),
    autoRetriedDeadlines: new Map(),
}

/**
 * A retry carries what it was raised for: the failure or the release objects on screen. Once the
 * pipeline has handled that failure or replaced those releases, the retry finds nothing to do,
 * which drops repeated clicks and reconnect bursts instead of queueing them.
 */
export type FeedAction =
    | { kind: 'load-page'; furthestScrolledIndex: number; onlyWhenEmpty: boolean }
    | { kind: 'retry-page'; failure: PageFailure | null }
    | { kind: 'reload-items'; items: HydratedFeedItem[]; isAutomatic: boolean }

/** Rate-limited releases that reload together once their shared deadline passes. */
export type AutomaticReload = { deadline: number; items: HydratedFeedItem[] }

const isInAutoRetryWindow = (index: number, currentIndex: number) =>
    index >= currentIndex && index < currentIndex + AUTO_RETRY_WINDOW

/**
 * The deadline at which a rate-limited release reloads automatically, or null when it has none:
 * it failed for another reason, or it was already reloaded automatically for this deadline.
 */
const untriedDeadline = (state: FeedState, item: HydratedFeedItem): number | null => {
    const retryAt = item.error?.retryAt
    if (retryAt == null) return null
    return (state.autoRetriedDeadlines.get(item.id) ?? -Infinity) < retryAt ? retryAt : null
}

/** The next automatic reload: releases in the window that share the earliest untried deadline. */
export const nextAutomaticReload = (state: FeedState, currentIndex: number): AutomaticReload | null => {
    const waiting = state.items.flatMap((item, index) => {
        const deadline = untriedDeadline(state, item)
        return deadline !== null &&
            !state.reloadingIds.has(item.id) &&
            isInAutoRetryWindow(index, currentIndex)
            ? [{ item, deadline }]
            : []
    })
    if (waiting.length == 0) return null

    const deadline = Math.min(...waiting.map(release => release.deadline))
    return {
        deadline,
        items: waiting.filter(release => release.deadline <= deadline).map(({ item }) => item),
    }
}

export const isSameAutomaticReload = (a: AutomaticReload | null, b: AutomaticReload | null) =>
    a === b ||
    (a !== null &&
        b !== null &&
        a.deadline === b.deadline &&
        a.items.length === b.items.length &&
        a.items.every((item, index) => item === b.items[index]))

/**
 * The releases a reload action may still reload. Each must still be on screen as the same failed
 * release, and not reloading already. An automatic reload may have waited behind a page load, so
 * its releases must also still be in the window with their deadline untried.
 */
export const releasesToReload = (
    state: FeedState,
    { items, isAutomatic }: Extract<FeedAction, { kind: 'reload-items' }>,
    currentIndex: number,
): HydratedFeedItem[] =>
    items
        .filter(item => {
            const index = state.items.indexOf(item)
            return (
                item.error !== null &&
                index !== -1 &&
                !state.reloadingIds.has(item.id) &&
                (!isAutomatic ||
                    (untriedDeadline(state, item) !== null && isInAutoRetryWindow(index, currentIndex)))
            )
        })
        .slice(0, MAX_RELOAD_BATCH)

/** Marks releases as reloading. An automatic reload uses up their current deadline. */
export const startReloading = (
    state: FeedState,
    items: HydratedFeedItem[],
    isAutomatic: boolean,
): FeedState => {
    const reloadingIds = new Set(items.map(item => item.id))
    if (!isAutomatic) return { ...state, reloadingIds }

    const autoRetriedDeadlines = new Map(state.autoRetriedDeadlines)
    for (const item of items) {
        if (item.error?.retryAt != null) autoRetriedDeadlines.set(item.id, item.error.retryAt)
    }
    return { ...state, reloadingIds, autoRetriedDeadlines }
}

/** Swaps each reloaded release in by ID, so its entry and every other release stay where they are. */
export const finishReloading = (
    state: FeedState,
    reloaded: ReadonlyMap<string, HydratedFeedItem>,
): FeedState => ({
    ...state,
    reloadingIds: new Set(),
    items: state.items.map(item =>
        state.reloadingIds.has(item.id) ? (reloaded.get(item.id) ?? item) : item,
    ),
})

/** How a failed release gets back, as its status line describes it. */
export const recoveryOfRelease = (
    state: FeedState,
    item: HydratedFeedItem,
    index: number,
    currentIndex: number,
): ReleaseRecovery => {
    if (state.reloadingIds.has(item.id)) return 'reloading'
    const deadline = untriedDeadline(state, item)
    if (deadline === null) return 'manual'
    if (!isInAutoRetryWindow(index, currentIndex)) return 'when-in-view'
    // A passed deadline in the window reloads at once; say so rather than show a time already gone.
    return deadline > Date.now() ? 'scheduled' : 'reloading'
}
