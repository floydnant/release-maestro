import { Signal } from '@angular/core'
import { toObservable, toSignal } from '@angular/core/rxjs-interop'
import { BROWSE_WINDOW_MAX_LIMIT, type BrowseWindow, type BrowseWindowResult } from '@release-maestro/core'
import {
    EMPTY,
    Observable,
    Subject,
    catchError,
    combineLatest,
    defer,
    distinctUntilChanged,
    map,
    merge,
    of,
    startWith,
    scan,
    switchMap,
} from 'rxjs'

/**
 * The browse query primitive: filter/sort/search plus a viewport in, one window of
 * rows out, with cancellation and a total.
 *
 * It is entity-agnostic on purpose. The track list is the first consumer, but
 * releases, artists, record labels and genres all page the same way (ADR 0004), and
 * none of them should re-derive this.
 *
 * Shape follows the house pattern: signals hold the state, `toObservable` enters the
 * pipeline, `toSignal` lands the result back where a template can read it — nothing
 * subscribes in order to `set()` a signal.
 *
 * **`switchMap` is a behavioural choice here, not a default.** Scrolling supersedes:
 * once the viewport has moved on, the window it moved away from is worthless, so the
 * in-flight one is abandoned and the newest wins. The IPC request itself cannot be
 * recalled — what is cancelled is our interest in its answer, which is what keeps a
 * slow window from overwriting a fast newer one.
 */

export type BrowseStatus = 'loading' | 'ready' | 'error'

export interface BrowseResult<TRow> {
    status: BrowseStatus
    /** Index of `rows[0]` within the full ordering. */
    offset: number
    /** Only the rows for the current window — never the whole result set. */
    rows: TRow[]
    /** Row count of the whole query, which is what gives the scrollbar its height. */
    total: number
    error: string | null
    /**
     * False until the first window has landed at all. It stays true across later
     * queries, because those keep the previous rows visible while they load.
     */
    loaded: boolean
}

export interface BrowseQueryOptions<TQuery, TRow> {
    /** The filter + sort + search currently in force. */
    query: Signal<TQuery>
    /** The slice the viewport wants. Changes constantly while scrolling. */
    viewport: Signal<BrowseWindow>
    fetchWindow: (query: TQuery, window: BrowseWindow) => Promise<BrowseWindowResult<TRow>>
    /**
     * Refetch triggers that are not user input — throttled scan progress, most of
     * all. Browse views deliberately refetch while a scan ingests songs.
     */
    refresh?: Observable<unknown>
    /**
     * Value equality for the query. Two structurally equal queries must compare
     * equal or every rebuild refetches and drops the rows on screen. Defaults to
     * reference identity, which is right when the caller holds queries immutably.
     */
    sameQuery?: (left: TQuery, right: TQuery) => boolean
    /**
     * Plural noun for what is being browsed, in user-facing copy: `tracks`, `albums`.
     * Only reached by the last-resort error message, when a failure carries no message
     * of its own — but this module serves every browse surface, so it cannot be the
     * one deciding they are all tracks.
     */
    entityLabel?: string
}

export interface BrowseQuery<TRow> {
    result: Signal<BrowseResult<TRow>>
    /** The row at an absolute index, or `undefined` when it is outside the window. */
    rowAt: (index: number) => TRow | undefined
    /** Re-run the current window after a failure. */
    retry: () => void
}

const initialResult = <TRow>(): BrowseResult<TRow> => ({
    status: 'loading',
    offset: 0,
    rows: [],
    total: 0,
    error: null,
    loaded: false,
})

export const createBrowseQuery = <TQuery, TRow>(
    options: BrowseQueryOptions<TQuery, TRow>,
): BrowseQuery<TRow> => {
    const sameQuery = options.sameQuery ?? Object.is
    const retry$ = new Subject<void>()

    const query$ = toObservable(options.query).pipe(distinctUntilChanged(sameQuery))
    const viewport$ = toObservable(options.viewport).pipe(
        map(clampWindow),
        distinctUntilChanged((left, right) => left.offset == right.offset && left.limit == right.limit),
    )

    const state = toSignal(
        combineLatest([
            query$,
            viewport$,
            merge(options.refresh ?? EMPTY, retry$).pipe(startWith(null)),
        ]).pipe(
            switchMap(([query, window]) =>
                defer(() => options.fetchWindow(query, window)).pipe(
                    map((response): BrowseReducer<TRow> => () => ({
                        status: 'ready',
                        offset: response.offset,
                        rows: response.rows,
                        total: response.total,
                        error: null,
                        loaded: true,
                    })),
                    catchError(error =>
                        of((previous: BrowseResult<TRow>): BrowseResult<TRow> => ({
                            ...previous,
                            status: 'error',
                            error: browseErrorMessage(error, options.entityLabel ?? 'results'),
                        })),
                    ),
                    // Emitted before the request settles, and it deliberately keeps the
                    // rows already on screen — including across a *query* change.
                    //
                    // Blanking them would be more literally correct, since they answer
                    // the previous question. It also makes the table flash a loading
                    // state on every keystroke of a search, which is far worse to use
                    // than a moment of slightly stale rows under a busy indicator.
                    startWith((previous: BrowseResult<TRow>): BrowseResult<TRow> => ({
                        ...previous,
                        status: 'loading',
                        error: null,
                    })),
                ),
            ),
            scan((previous, reducer) => reducer(previous), initialResult<TRow>()),
        ),
        { initialValue: initialResult<TRow>() },
    )

    return {
        result: state,
        rowAt: index => {
            const current = state()
            return current.rows[index - current.offset]
        },
        retry: () => retry$.next(),
    }
}

/** How one pipeline emission folds into the visible result. */
type BrowseReducer<TRow> = (previous: BrowseResult<TRow>) => BrowseResult<TRow>

/**
 * Keep a requested window inside what the main process will serve. An over-scrolled
 * viewport asking for a negative offset is routine, not an error.
 */
const clampWindow = (window: BrowseWindow): BrowseWindow => ({
    offset: Math.max(0, Math.trunc(window.offset)),
    limit: Math.min(BROWSE_WINDOW_MAX_LIMIT, Math.max(0, Math.trunc(window.limit))),
})

const browseErrorMessage = (error: unknown, entityLabel: string): string => {
    if (typeof error == 'string') return error
    if (error != null && typeof error == 'object' && 'userFacingMessage' in error) {
        return String(error.userFacingMessage)
    }
    if (error instanceof Error) return error.message
    return `Could not load ${entityLabel}`
}
