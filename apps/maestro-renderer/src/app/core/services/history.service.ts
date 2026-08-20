import { Location } from '@angular/common'
import { computed, DestroyRef, inject, Injectable, signal } from '@angular/core'
import { NavigationCancel, NavigationEnd, NavigationStart, Router } from '@angular/router'

/**
 * The back/forward stack, as this app understands it.
 *
 * **Why not just ask the platform.** `history.length` says how deep the stack is and
 * nothing else: there is no API anywhere that answers "is there an entry ahead of me",
 * and a back button that is always enabled is a button that lies. So the cursor is
 * tracked here, from `Router` events, and the two signals the chrome binds to are
 * derived from it rather than guessed.
 *
 * **A navigation is one of three things**, and every rule in this file is about telling
 * them apart:
 *
 * | Kind | How it is recognised | What it does |
 * | -- | -- | -- |
 * | Push | anything else | truncates the forward entries, then appends one |
 * | Restore | `NavigationStart.restoredState` is set (popstate) | moves the cursor to that entry |
 * | Replace | `replaceUrl`, `skipLocationChange`, or a URL identical to the current one | rewrites the entry under the cursor |
 *
 * The last two replace cases are not belt and braces: `Router` replaces rather than
 * pushes whenever the serialized URL already matches the browser's, so a model that
 * only honoured the `replaceUrl` flag would drift by one entry the first time that
 * happened.
 *
 * **Only `NavigationEnd` moves the model** — with one exception below. A navigation that
 * a guard turns into a `UrlTree` never ends; it is cancelled, and the redirect that
 * follows it is a separate navigation. Counting endings is therefore what keeps a
 * bounced Back from leaving a dead entry behind: the bounce contributes nothing, and the
 * redirect contributes the one entry the browser actually got.
 *
 * The exception is a cancelled *restore*. The browser has already moved by the time a
 * popstate reaches Angular, so a cancellation cannot un-move it — the cursor has to
 * follow, or the model is one entry behind the window it describes.
 *
 * **Scroll is remembered per entry**, keyed by the entry's index rather than by its
 * navigation id, because a replace keeps the index and changes the id: the sort you just
 * applied should not lose the position you applied it at. See {@link scrollRestore} for
 * what the surfaces do with it.
 */
@Injectable({ providedIn: 'root' })
export class HistoryService {
    private router = inject(Router)
    private location = inject(Location)

    /**
     * The URL at each entry, in order, and where in it we are. Held together because
     * every read of one is a read of the other, and a torn pair is a wrong button.
     */
    private stack = signal<{ urls: readonly string[]; cursor: number }>({ urls: [], cursor: NO_ENTRY })

    /**
     * Which entry each navigation id landed on.
     *
     * A restore names the id the entry was *created* with, which may be many
     * navigations ago, so the mapping has to outlive the navigation that made it. Ids
     * of truncated entries are dropped with them; ids of replaced entries are kept and
     * point at the same index, which is where a popstate naming either of them belongs.
     */
    private indexById = new Map<number, number>()

    /** `scrollTop` last seen at each entry, in pixels. */
    private scrollByIndex = new Map<number, number>()

    /** What the in-flight navigation turned out to be, decided at its start. */
    private pending: PendingNavigation | null = null

    /** Reads the active surface's scroll position, when one has registered itself. */
    private scrollProvider: (() => number | null) | null = null

    readonly canGoBack = computed(() => this.stack().cursor > 0)
    readonly canGoForward = computed(() => {
        const { urls, cursor } = this.stack()
        return cursor >= 0 && cursor < urls.length - 1
    })

    /**
     * The scroll position the entry being restored was left at, or null when this is
     * not a restore — set at `NavigationStart`, which is the only moment early enough
     * to be useful.
     *
     * A browse surface is constructed during route activation, *before* `NavigationEnd`,
     * and the first thing it does is ask for a window. Reading this then is what lets it
     * ask for the window the user was actually looking at, rather than fetching the top
     * of the list and throwing it away a frame later.
     *
     * It stays set until a surface {@link consumeScrollRestore}s it, so that the
     * virtualiser can wait for the canvas to be tall enough to scroll to. Anything that
     * navigates in the meantime clears it: it describes one entry, not a page.
     */
    readonly scrollRestore = signal<number | null>(null)

    constructor() {
        const subscription = this.router.events.subscribe(event => {
            if (event instanceof NavigationStart) this.onNavigationStart(event)
            else if (event instanceof NavigationEnd) this.onNavigationEnd(event)
            else if (event instanceof NavigationCancel) this.onNavigationCancel()
        })
        inject(DestroyRef).onDestroy(() => subscription.unsubscribe())
    }

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

    // -----------------------------------------------------------------------

    private onNavigationStart(event: NavigationStart): void {
        const restoredId = event.restoredState?.navigationId ?? null
        const restoredIndex = restoredId == null ? null : (this.indexById.get(restoredId) ?? null)

        // `getCurrentNavigation` is only non-null while a navigation is in flight, which
        // is exactly here — by `NavigationEnd` the router has already let it go.
        const extras = this.router.getCurrentNavigation()?.extras
        this.pending = {
            restoredIndex,
            replaces: !!extras?.replaceUrl || !!extras?.skipLocationChange,
        }

        this.rememberScroll()
        this.scrollRestore.set(restoredIndex == null ? null : (this.scrollByIndex.get(restoredIndex) ?? null))
    }

    private onNavigationEnd(event: NavigationEnd): void {
        const pending = this.pending
        this.pending = null

        // `urlAfterRedirects` rather than `url`, because a `redirectTo` in the route
        // config produces one history entry holding the URL it redirected *to* — the
        // one the user can come back to.
        const url = event.urlAfterRedirects
        const { urls, cursor } = this.stack()

        if (cursor == NO_ENTRY) {
            // The app's first navigation is the bottom of the stack, whatever else it
            // looks like. It is routinely a redirect (`''` → `/home`) and would
            // otherwise read as a replace of an entry that does not exist yet.
            this.commit([url], 0, event.id)
            return
        }

        if (pending?.restoredIndex != null) {
            // Angular rewrites the restored entry's state with the new navigation's id,
            // so the entry has to answer to that id from here on.
            this.commit(replacedAt(urls, pending.restoredIndex, url), pending.restoredIndex, event.id)
            return
        }

        if (pending?.replaces || url == urls[cursor]) {
            this.commit(replacedAt(urls, cursor, url), cursor, event.id)
            return
        }

        for (let index = cursor + 1; index < urls.length; index++) this.scrollByIndex.delete(index)
        for (const [id, index] of this.indexById) if (index > cursor) this.indexById.delete(id)

        this.commit([...urls.slice(0, cursor + 1), url], cursor + 1, event.id)
    }

    /**
     * A cancelled restore still moved the browser. Nothing else about a cancellation is
     * this model's business: an imperative navigation that never ended never reached the
     * address bar either.
     */
    private onNavigationCancel(): void {
        const pending = this.pending
        this.pending = null

        const restoredIndex = pending?.restoredIndex
        if (restoredIndex == null) return

        this.stack.update(({ urls }) => ({ urls, cursor: restoredIndex }))
    }

    private commit(urls: readonly string[], cursor: number, navigationId: number): void {
        this.indexById.set(navigationId, cursor)
        this.stack.set({ urls, cursor })
    }

    private rememberScroll(): void {
        const cursor = this.stack().cursor
        if (cursor == NO_ENTRY) return

        const scrollTop = this.scrollProvider?.() ?? null
        if (scrollTop == null) return

        this.scrollByIndex.set(cursor, scrollTop)
    }
}

interface PendingNavigation {
    /** The entry a popstate is restoring, or null when this navigation is not one. */
    restoredIndex: number | null
    replaces: boolean
}

/** Before the first navigation has ended there is no entry to be on. */
const NO_ENTRY = -1

const replacedAt = (urls: readonly string[], index: number, url: string): string[] =>
    urls.map((existing, position) => (position == index ? url : existing))
