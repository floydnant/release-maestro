import { Location } from '@angular/common'
import { computed, inject, Injectable, linkedSignal } from '@angular/core'
import { toSignal } from '@angular/core/rxjs-interop'
import {
    NavigationCancel,
    NavigationCancellationCode,
    NavigationEnd,
    NavigationSkipped,
    NavigationStart,
    Router,
    type Event as RouterEvent,
} from '@angular/router'
import { filter, map, scan } from 'rxjs'

/**
 * The back/forward stack, as this app understands it.
 *
 * **Why not just ask the platform.** `history.length` says how deep the stack is and
 * nothing else: there is no API anywhere that answers "is there an entry ahead of me",
 * and a back button that is always enabled is a button that lies. So the cursor is
 * tracked here, from `Router` events, and the two signals the chrome binds to are
 * derived from it rather than guessed.
 *
 * **A navigation is one of four things**, and every rule in {@link advance} is about
 * telling them apart. The recogniser is written against what `Router` actually does to
 * the address bar — `setBrowserUrl` in `@angular/router` — rather than against the flag
 * the caller passed, because they are not the same thing:
 *
 * | Kind | How it is recognised | What it does |
 * | -- | -- | -- |
 * | Push | anything else | truncates the forward entries, then appends one |
 * | Restore | `NavigationStart.restoredState` is set (popstate) | moves the cursor to that entry |
 * | Replace | `replaceUrl`, or a URL identical to the current one | rewrites the entry under the cursor |
 * | Invisible | `skipLocationChange` | nothing — the router never touched the address bar |
 *
 * The last two are not belt and braces. `Router` replaces rather than pushes whenever
 * the serialized URL already matches the browser's, so a model that only honoured the
 * `replaceUrl` flag would drift by one entry the first time that happened; and
 * `skipLocationChange` skips `setBrowserUrl` altogether, so the entry keeps both its URL
 * and its navigation id.
 *
 * **Only a navigation that ends moves the stack** — with one exception. A navigation a
 * guard turns into a `UrlTree` never ends; it is cancelled, and the redirect that follows
 * it is a separate navigation. Counting endings is what keeps a bounced Back from leaving
 * a dead entry behind: the bounce contributes nothing, and the redirect contributes the
 * one entry the browser actually got.
 *
 * The exception is a cancelled *restore*. The browser has already moved by the time a
 * popstate reaches Angular, and a cancellation cannot un-move it — see {@link cancel},
 * where the two kinds of cancellation part company.
 *
 * **A `redirectTo` in the route config is a push, not a replace.** The ticket asked for
 * the opposite and it would be wrong: with the default `urlUpdateStrategy: 'deferred'`
 * the router writes the address bar once, at the end, with the URL it redirected *to* —
 * one `location.go`, one new entry. Treating it as a replace would lose an entry per
 * redirect, starting with the app's own `'' → /home`. See ADR 0006.
 *
 * **Scroll is remembered per entry**, keyed by the entry's position rather than by its
 * navigation id, because a replace keeps the position and changes the id: applying a sort
 * must not cost the place you applied it from.
 */
@Injectable({ providedIn: 'root' })
export class HistoryService {
    private router = inject(Router)
    private location = inject(Location)

    /** Reads the active surface's scroll position, when one has registered itself. */
    private scrollProvider: (() => number | null) | null = null

    /**
     * The stack, folded out of the router's event stream.
     *
     * A `scan` rather than a subscription that writes signals: the model is a pure
     * function of the events that produced it, which is exactly the shape
     * `angular-patterns` asks for — state in, stream in the middle, signal out — and it
     * means {@link advance} can be tested without a router at all.
     *
     * The two impure reads a navigation needs are lifted into the `map` above the fold,
     * so the fold itself stays pure. Both have to happen at `NavigationStart`:
     * `getCurrentNavigation` is null by the time a navigation ends, and the outgoing
     * surface is only still scrolled before the incoming route activates.
     */
    private model = toSignal(
        this.router.events.pipe(
            filter(isStackEvent),
            map(event => ({
                event,
                extras: event instanceof NavigationStart ? this.router.getCurrentNavigation()?.extras : null,
                scrollTop: event instanceof NavigationStart ? (this.scrollProvider?.() ?? null) : null,
            })),
            scan(advance, emptyStack()),
        ),
        { initialValue: emptyStack() },
    )

    readonly canGoBack = computed(() => this.model().cursor > 0)
    readonly canGoForward = computed(() => {
        const { urls, cursor } = this.model()
        return cursor >= 0 && cursor < urls.length - 1
    })

    /**
     * The scroll position the entry being restored was left at, or null when this
     * navigation is not a restore — published at `NavigationStart`, which is the only
     * moment early enough to be useful.
     *
     * A browse surface is constructed during route activation, *before* `NavigationEnd`,
     * and the first thing it does is ask for a window. Reading this then is what lets it
     * ask for the window the user was actually looking at, rather than fetching the top
     * of the list and throwing it away a frame later.
     *
     * Writable, so that a surface can {@link consumeScrollRestore} once it has applied
     * the position; the `linkedSignal` re-seeds it from the fold on the next navigation.
     * Until then it stays offered, because the virtualiser has to wait for a canvas tall
     * enough to scroll down.
     *
     * **A page latches this for its own arrival rather than tracking it.** The surface
     * being left is still alive and still rendering while the incoming route's guards
     * run, so a surface that followed this signal would apply — and consume — a position
     * that belongs to the page replacing it. See `TracksComponent.restoreScrollTop`.
     */
    readonly scrollRestore = linkedSignal(() => this.model().scrollRestore)

    back(): void {
        if (!this.canGoBack()) return
        this.location.back()
    }

    forward(): void {
        if (!this.canGoForward()) return
        this.location.forward()
    }

    /**
     * Offer the scroll position of the surface currently on screen, so that leaving it
     * records where it was.
     *
     * A provider rather than a value the surface pushes, because the moment that matters
     * — `NavigationStart`, while the outgoing component is still alive and still
     * scrolled — belongs to this service and not to the page.
     *
     * @returns an unregister function for the surface's `DestroyRef`.
     */
    registerScrollProvider(provider: () => number | null): () => void {
        this.scrollProvider = provider
        return () => {
            if (this.scrollProvider == provider) this.scrollProvider = null
        }
    }

    /** Say that {@link scrollRestore} has been applied, so nothing applies it twice. */
    consumeScrollRestore(): void {
        this.scrollRestore.set(null)
    }
}

// ---------------------------------------------------------------------------
// The fold. Exported for its own spec; nothing else should reach for it.

/** Before the first navigation has ended there is no entry to be on. */
export const NO_ENTRY = -1

/**
 * The stack, and everything the next event needs in order to be classified.
 *
 * `index` and `scroll` are mutated in place rather than copied per event. They are
 * reachable only from the fold, and copying two maps on every navigation to preserve a
 * purity nothing observes is a cost with no reader.
 */
export interface HistoryStack {
    /** The URL at each entry, in order. */
    urls: readonly string[]
    cursor: number
    /** Which entry each navigation id last landed on. */
    index: Map<number, number>
    /** `scrollTop` last seen at each entry, in pixels. */
    scroll: Map<number, number>
    scrollRestore: number | null
    /** What the in-flight navigation turned out to be, decided at its start. */
    pending: PendingNavigation | null
    /** The id the entry under the cursor currently answers to. */
    cursorId: number | null
}

interface PendingNavigation {
    /** The entry a popstate is restoring, or null when this navigation is not one. */
    restoredIndex: number | null
    replaces: boolean
    /** `skipLocationChange`: the address bar is not touched at all. */
    invisible: boolean
}

/** One router event, with the two things that can only be read as it starts. */
interface StackStep {
    event: RouterEvent
    extras: { replaceUrl?: boolean; skipLocationChange?: boolean } | null | undefined
    scrollTop: number | null
}

export const emptyStack = (): HistoryStack => ({
    urls: [],
    cursor: NO_ENTRY,
    index: new Map(),
    scroll: new Map(),
    scrollRestore: null,
    pending: null,
    cursorId: null,
})

/**
 * Every event that can move the stack, plus the two that end a navigation without
 * moving it. `NavigationSkipped` and `NavigationError` are in the list precisely
 * *because* they change nothing: they end a navigation this fold has already opened a
 * {@link PendingNavigation} for, and leaving that open would classify the next
 * navigation as this one.
 */
const isStackEvent = (
    event: RouterEvent,
): event is NavigationStart | NavigationEnd | NavigationCancel | NavigationSkipped =>
    event instanceof NavigationStart ||
    event instanceof NavigationEnd ||
    event instanceof NavigationCancel ||
    event instanceof NavigationSkipped

export const advance = (stack: HistoryStack, step: StackStep): HistoryStack => {
    if (step.event instanceof NavigationStart) return begin(stack, step, step.event)
    if (step.event instanceof NavigationEnd) return end(stack, step.event)
    if (step.event instanceof NavigationCancel) return cancel(stack, step.event)
    return { ...stack, pending: null }
}

const begin = (stack: HistoryStack, step: StackStep, event: NavigationStart): HistoryStack => {
    const restoredId = event.restoredState?.navigationId ?? null
    const restoredIndex = restoredId == null ? null : (stack.index.get(restoredId) ?? null)

    if (stack.cursor != NO_ENTRY && step.scrollTop != null) stack.scroll.set(stack.cursor, step.scrollTop)

    return {
        ...stack,
        pending: {
            restoredIndex,
            replaces: !!step.extras?.replaceUrl,
            invisible: !!step.extras?.skipLocationChange,
        },
        scrollRestore: restoredIndex == null ? null : (stack.scroll.get(restoredIndex) ?? null),
    }
}

const end = (stack: HistoryStack, event: NavigationEnd): HistoryStack => {
    const pending = stack.pending
    const settled = { ...stack, pending: null }

    // The router skipped `setBrowserUrl` entirely, so the entry the browser holds still
    // has the URL and the navigation id it had before this navigation.
    if (pending?.invisible) return settled

    // `urlAfterRedirects` rather than `url`: a `redirectTo` in the route config produces
    // one entry, holding the URL it redirected *to* — the one Back returns to.
    const url = event.urlAfterRedirects

    // The app's first navigation is the bottom of the stack, whatever else it looks
    // like. It is routinely a redirect and would otherwise read as a replace of an
    // entry that does not exist yet.
    if (stack.cursor == NO_ENTRY) return occupy(settled, [url], 0, event.id)

    const restoredIndex = pending?.restoredIndex
    if (restoredIndex != null) {
        return occupy(settled, replacedAt(stack.urls, restoredIndex, url), restoredIndex, event.id)
    }

    if (pending?.replaces || url == stack.urls[stack.cursor]) {
        return occupy(settled, replacedAt(stack.urls, stack.cursor, url), stack.cursor, event.id)
    }

    for (let position = stack.cursor + 1; position < stack.urls.length; position++) {
        retire(stack, position)
        stack.scroll.delete(position)
    }

    const kept = stack.urls.slice(0, stack.cursor + 1)
    return occupy(settled, [...kept, url], stack.cursor + 1, event.id)
}

/**
 * A cancelled navigation, of which only two kinds can move anything.
 *
 * A cancellation of an *imperative* navigation is invisible here: with the default
 * `urlUpdateStrategy: 'deferred'` the address bar was never written, so there is nothing
 * to undo. A cancelled *restore* is the opposite — the browser moved before Angular saw
 * the popstate at all — and what happens next depends on why it was cancelled:
 *
 * - **A redirect** (a guard answering with a `UrlTree`) leaves the browser where it
 *   landed and starts a fresh navigation, which replaces that entry. So the cursor
 *   follows and the entry is left for the redirect to rewrite.
 * - **Anything else** — a guard answering `false`, a resolver failing — makes the router
 *   call `resetUrlToCurrentUrlTree`, which writes the URL and the id of the entry we
 *   came *from* into the entry the browser moved to. The model has to do the same.
 *
 * That second case leaves one navigation id naming two entries, which is a limitation of
 * `canceledNavigationResolution: 'replace'` and not of this fold — the router's own
 * `'computed'` mode exists because of it. The later entry wins, which is where the
 * browser is.
 */
const cancel = (stack: HistoryStack, event: NavigationCancel): HistoryStack => {
    const restoredIndex = stack.pending?.restoredIndex
    const settled = { ...stack, pending: null }
    if (restoredIndex == null) return settled

    if (event.code == NavigationCancellationCode.Redirect) return { ...settled, cursor: restoredIndex }

    const carried = stack.urls[stack.cursor] ?? stack.urls[restoredIndex] ?? ''
    return occupy(
        settled,
        replacedAt(stack.urls, restoredIndex, carried),
        restoredIndex,
        stack.cursorId ?? NO_ENTRY,
    )
}

/**
 * Put the cursor on an entry and make that entry answer to a navigation id.
 *
 * Ids already naming the entry are retired with it. The router overwrote the browser
 * entry's state, so no popstate can name them again — and without this, one id per query
 * edit would accumulate for as long as the window is open.
 */
const occupy = (
    stack: HistoryStack,
    urls: readonly string[],
    cursor: number,
    navigationId: number,
): HistoryStack => {
    retire(stack, cursor)
    stack.index.set(navigationId, cursor)
    return { ...stack, urls, cursor, cursorId: navigationId }
}

const retire = (stack: HistoryStack, position: number): void => {
    for (const [id, index] of stack.index) if (index == position) stack.index.delete(id)
}

const replacedAt = (urls: readonly string[], index: number, url: string): string[] =>
    urls.map((existing, position) => (position == index ? url : existing))
