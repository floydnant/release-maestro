import { type SelectionRange } from '@release-maestro/core'

/**
 * Browse selection mechanics, per
 * [ADR 0004](../../../../../../docs/adr/0004-browse-queries-are-windowed-and-selections-carry-a-query.md).
 *
 * A selection is not a list of rows. `Cmd-A` on a 500k library would otherwise mean
 * serialising 500k ids through structured clone on every change, so a selection
 * carries index ranges within its query's ordering, plus the individual rows added
 * outside them or removed inside them.
 *
 * **Entity-agnostic on purpose.** Tracks are the first surface, but releases, artists,
 * record labels and genres all select the same way, and none of them should re-derive
 * this. Everything here is generic over the query type; `song-selection.ts` binds it
 * to songs, and a second entity binds it the same way in a dozen lines.
 *
 * **Why this keeps indices the wire format does not.** The wire format carries
 * `excluded`/`included` as bare id arrays, which is all the main process needs to
 * resolve them in SQL. But the renderer has to answer "is this row selected?" and
 * "how many are selected?" without a round trip, and an id alone cannot say whether it
 * falls inside a range. The renderer knows every row's index when the user clicks it,
 * so it keeps them, and {@link toWireSelection} drops them at the boundary.
 *
 * The invariants below are what make the count exact, and every operation restores
 * them:
 *
 * - every `excluded` row lies inside some range;
 * - no `included` row lies inside any range;
 * - ranges are disjoint, non-empty and sorted.
 *
 * So `size = Σ range lengths − excluded + included` is always correct.
 */

/** A row the user picked out by hand, with the index it had when they did. */
export interface SelectedRow {
    id: string
    index: number
}

/**
 * The renderer's working selection: the wire shape, the indices it elides, and the two
 * pieces of position that only mean anything relative to it.
 *
 * **All of it lives here on purpose.** The cursor and the anchor were previously fields
 * on the table component, reconciled separately from the selection and from each other
 * — three pieces of "where the selection is" with three rules for when they go stale.
 * Every one of them was a bug: the anchor outlived a refetch that cleared the ranges it
 * pointed into, and the cursor outlived a sort change, so the first arrow key after
 * re-sorting resumed from wherever the old selection had been. One value with one set of
 * reconcilers is what makes those states impossible rather than merely fixed.
 */
export interface BrowseSelectionState<TQuery> {
    /** The filter + sort the {@link ranges} indices are meaningful against. */
    query: TQuery
    ranges: SelectionRange[]
    /** Rows deselected inside {@link ranges}. */
    excluded: SelectedRow[]
    /** Rows selected outside {@link ranges}. */
    included: SelectedRow[]
    /**
     * Where the next arrow key moves from. An index, so it means nothing against a
     * different ordering and nothing past the end of a shrunken result set.
     *
     * `-1` means "nowhere yet", which is what a cleared selection resets it to. Arrow
     * arithmetic then lands the first press on row 0 without anyone testing for it —
     * `min(last, -1 + 1)` and `max(0, -1 - 1)` are both 0. Branching on "is the
     * selection empty?" instead would read a selection that a click may not have
     * finished propagating, and answer the wrong question a keystroke later.
     */
    cursor: number
    /** Where a shift-extension measures from — see {@link SelectionAnchor}. */
    anchor: SelectionAnchor<TQuery> | null
}

/** What crosses IPC, and what an action resolves in SQL. */
export interface WireSelection<TQuery> {
    query: TQuery
    ranges: SelectionRange[]
    excluded: string[]
    included: string[]
}

export type QueryComparator<TQuery> = (left: TQuery, right: TQuery) => boolean

export const emptySelection = <TQuery>(query: TQuery): BrowseSelectionState<TQuery> => ({
    query,
    ranges: [],
    excluded: [],
    included: [],
    cursor: NO_CURSOR,
    anchor: null,
})

/** No row has been arrowed to yet — see {@link BrowseSelectionState.cursor}. */
export const NO_CURSOR = -1

export const toWireSelection = <TQuery>(state: BrowseSelectionState<TQuery>): WireSelection<TQuery> => ({
    query: state.query,
    ranges: state.ranges,
    excluded: state.excluded.map(row => row.id),
    included: state.included.map(row => row.id),
})

/**
 * Whether a row is selected.
 *
 * Hand-picked rows are matched **by id**, not by the index they were picked at. A scan
 * refetch shifts rows underneath a selection, and `selectionAfterRefetch` deliberately
 * keeps id-only selections through it on the grounds that "an id means the same row
 * wherever it moved to" — which is only true if this agrees. Matching on the stored
 * index instead left the highlight on whatever row had inherited it, while
 * {@link toWireSelection} sent the *id* on to the action: the user acts on one song
 * and watches a different one being acted upon.
 *
 * Range membership is still positional, because a range is a pair of indices and has
 * no other meaning. That is sound because a total change drops ranges outright.
 */
export const isSelected = <TQuery>(state: BrowseSelectionState<TQuery>, row: SelectedRow): boolean =>
    isInRanges(state.ranges, row.index)
        ? !state.excluded.some(excluded => excluded.id == row.id)
        : state.included.some(included => included.id == row.id)

/**
 * How many rows the selection covers. Exact at any size, and it never enumerates a
 * range — the point of the whole model is that `Cmd-A` costs one pair of numbers.
 */
export const selectionSize = <TQuery>(state: BrowseSelectionState<TQuery>): number =>
    state.ranges.reduce((total, range) => total + range.end - range.start, 0) -
    state.excluded.length +
    state.included.length

export const isEmptySelection = <TQuery>(state: BrowseSelectionState<TQuery>): boolean =>
    selectionSize(state) == 0

/** Plain click: this row and nothing else. */
export const selectOnly = <TQuery>(query: TQuery, row: SelectedRow): BrowseSelectionState<TQuery> => ({
    query,
    ranges: [],
    excluded: [],
    included: [row],
    cursor: row.index,
    anchor: null,
})

/** Drop everything, keeping the query the selection was relative to. */
export const clearSelection = <TQuery>(state: BrowseSelectionState<TQuery>): BrowseSelectionState<TQuery> =>
    emptySelection(state.query)

/** Cmd-click: flip one row, leaving the rest of the selection alone. */
export const toggleRow = <TQuery>(
    state: BrowseSelectionState<TQuery>,
    row: SelectedRow,
): BrowseSelectionState<TQuery> => {
    // By id, for the same reason as `isSelected`: the stored index is where the row
    // was when it was picked, which a refetch may since have changed.
    if (isInRanges(state.ranges, row.index)) {
        const alreadyExcluded = state.excluded.some(excluded => excluded.id == row.id)
        return {
            ...state,
            excluded: alreadyExcluded
                ? state.excluded.filter(excluded => excluded.id != row.id)
                : [...state.excluded, row],
        }
    }

    const alreadyIncluded = state.included.some(included => included.id == row.id)
    return {
        ...state,
        included: alreadyIncluded
            ? state.included.filter(included => included.id != row.id)
            : [...state.included, row],
    }
}

/**
 * Select `[start, end)`.
 *
 * Non-additive replaces the whole selection, which is what a plain shift-click means
 * everywhere else. `additive` merges the range in and keeps what was already there.
 *
 * Either way the new range is **fresh**: any row it covers becomes selected, so
 * exclusions and hand-picked inclusions inside it are dropped rather than left to
 * punch holes in a range the user just drew over them.
 */
export const selectRange = <TQuery>(
    state: BrowseSelectionState<TQuery>,
    range: SelectionRange,
    { additive = false }: { additive?: boolean } = {},
): BrowseSelectionState<TQuery> => {
    const normalized = normalizeRange(range)
    if (!normalized) return state
    if (!additive) {
        return { ...state, ranges: [normalized], excluded: [], included: [] }
    }

    return restoreInvariants({
        ...state,
        ranges: mergeRanges([...state.ranges, normalized]),
        excluded: state.excluded.filter(row => !isInRange(normalized, row.index)),
        included: state.included.filter(row => !isInRange(normalized, row.index)),
    })
}

/**
 * Deselect `[start, end)` — the inverse gesture, reached by cmd-shift-clicking from a
 * row the user just cmd-clicked *off*.
 *
 * The range is cut out of the existing ranges rather than covered with exclusions.
 * Excluding row by row would be correct but unbounded: deselecting a 100k-row span
 * would mean 100k ids, which is exactly what the model exists to avoid. Splitting a
 * range costs at most one extra pair of numbers.
 */
export const deselectRange = <TQuery>(
    state: BrowseSelectionState<TQuery>,
    range: SelectionRange,
): BrowseSelectionState<TQuery> => {
    const normalized = normalizeRange(range)
    if (!normalized) return state

    return restoreInvariants({
        ...state,
        ranges: subtractRange(state.ranges, normalized),
        excluded: state.excluded.filter(row => !isInRange(normalized, row.index)),
        included: state.included.filter(row => !isInRange(normalized, row.index)),
    })
}

/** Cmd-A: one pair of numbers, whatever the library's size. */
export const selectAll = <TQuery>(query: TQuery, total: number): BrowseSelectionState<TQuery> =>
    total <= 0
        ? emptySelection(query)
        : {
              ...emptySelection(query),
              ranges: [{ start: 0, end: total }],
          }

/**
 * Reconcile a selection with a refetch.
 *
 * Browse views refetch as a scan ingests rows, and an insert above a selected range
 * silently changes what `[[12, 45)]` refers to — an action would then hit the wrong
 * files. So any selection holding ranges is dropped when the row count changes.
 * Selections made only of ids survive: an id means the same row wherever it moved to.
 */
export const selectionAfterRefetch = <TQuery>(
    state: BrowseSelectionState<TQuery>,
    previousTotal: number,
    nextTotal: number,
): BrowseSelectionState<TQuery> => {
    if (previousTotal == nextTotal) return state

    // Ranges are indices into an ordering whose length just changed, and so is the
    // anchor — which additionally carries the selection it would re-apply, so leaving
    // it behind lets the next shift-click rebuild what this just cleared.
    if (state.ranges.length > 0) {
        return { ...emptySelection(state.query), cursor: clampCursor(state.cursor, nextTotal) }
    }

    // An id-only selection survives, because an id names the same row wherever it
    // moved to. The cursor still has to stay inside the result set.
    return { ...state, anchor: null, cursor: clampCursor(state.cursor, nextTotal) }
}

const clampCursor = (cursor: number, total: number): number => {
    if (cursor < 0) return NO_CURSOR
    return total <= 0 ? NO_CURSOR : Math.min(cursor, total - 1)
}

/**
 * Reconcile a selection with a new query. Index ranges mean nothing against a
 * different ordering, so searching, filtering or re-sorting drops the selection —
 * which is also what every other app does when the list underneath you changes.
 */
export const selectionForQuery = <TQuery>(
    state: BrowseSelectionState<TQuery>,
    query: TQuery,
    sameQuery: QueryComparator<TQuery>,
): BrowseSelectionState<TQuery> => (sameQuery(state.query, query) ? state : emptySelection(query))

// ---------------------------------------------------------------------------
// Gestures
// ---------------------------------------------------------------------------

/**
 * Where a shift-extension starts from, and what it means.
 *
 * A shift-click is not one gesture — what it does depends on how its anchor was set.
 * After a plain click it *replaces* the selection with the range; after a cmd-click it
 * *adds* one; and after a cmd-click that turned a selected row off, it *removes* one.
 * That last case is what lets the same gesture deselect a span.
 */
export interface SelectionAnchor<TQuery> {
    index: number
    /** True when the anchor came from an additive click, so extending keeps the rest. */
    additive: boolean
    /** Whether extending from this anchor selects or deselects the span. */
    mode: 'select' | 'deselect'
    /**
     * The selection as it stood when the anchor was set. Every extension re-applies
     * from here rather than from the current selection, so dragging a range shorter
     * shrinks it instead of leaving the longer one merged underneath.
     *
     * Always stored with its own `anchor` nulled. The anchor lives inside the
     * selection, so capturing one wholesale would nest the previous anchor inside this
     * one, and its predecessor inside that — a chain that grows with every gesture and
     * carries stale bases along with it.
     */
    base: BrowseSelectionState<TQuery>
}

/** One click, reduced to what selection semantics actually depend on. */
export interface SelectionGesture {
    index: number
    /**
     * The row's id, or null when the row is outside the loaded window. A pointer
     * gesture always has one; a keyboard jump past the loaded window does not, and
     * is answered with a positional range instead.
     */
    id: string | null
    shiftKey: boolean
    /** Cmd on macOS, Ctrl elsewhere. */
    toggleKey: boolean
}

/** Read a gesture off a pointer event. Any browse surface can use this verbatim. */
export const selectionGestureFrom = (event: MouseEvent, row: SelectedRow): SelectionGesture => ({
    index: row.index,
    id: row.id,
    shiftKey: event.shiftKey,
    toggleKey: event.metaKey || event.ctrlKey,
})

/** True when a click with these modifiers is meant for the selection, not for a link. */
export const isSelectionModifierHeld = (event: MouseEvent): boolean =>
    event.shiftKey || event.metaKey || event.ctrlKey

/**
 * Apply a click to a selection, returning the whole next selection — cursor and anchor
 * included.
 *
 * Kept out of any component because it is selection semantics rather than rendering,
 * and because the case matrix is worth testing without a DOM. Taking and returning one
 * value is what stops a caller from updating the selection and forgetting the two
 * pieces of position that only mean anything against it.
 */
export const applySelectionGesture = <TQuery>(
    state: BrowseSelectionState<TQuery>,
    gesture: SelectionGesture,
    sameQuery: QueryComparator<TQuery>,
): BrowseSelectionState<TQuery> => {
    // An anchor from a different query points into an ordering that no longer exists.
    const usableAnchor = state.anchor && sameQuery(state.anchor.base.query, state.query) ? state.anchor : null

    if (gesture.shiftKey && usableAnchor) {
        const span = {
            start: Math.min(usableAnchor.index, gesture.index),
            end: Math.max(usableAnchor.index, gesture.index) + 1,
        }
        const selection =
            usableAnchor.mode == 'deselect'
                ? deselectRange(usableAnchor.base, span)
                : selectRange(usableAnchor.base, span, {
                      additive: usableAnchor.additive || gesture.toggleKey,
                  })

        // The anchor stays put, so extending again re-measures from the same row.
        return { ...selection, cursor: gesture.index, anchor: usableAnchor }
    }

    if (gesture.id == null) {
        // The row is outside the loaded window — a keyboard jump to the end of a large
        // list gets there long before the data does — so there is no id to hand-pick
        // it with. A range needs none: a one-row range addresses it positionally,
        // which is exactly what ranges are for, and the main process resolves it in
        // SQL the same way. Returning the selection unchanged instead used to move the
        // viewport while leaving the old row selected.
        //
        // Toggling is the exception. Cmd-clicking a row means "this specific row, on
        // top of the rest", and that is a claim about a row we cannot name yet.
        if (gesture.toggleKey) return { ...state, anchor: usableAnchor }

        const selection = selectRange(state, { start: gesture.index, end: gesture.index + 1 })
        return {
            ...selection,
            cursor: gesture.index,
            anchor: anchorAt(gesture.index, { additive: false, mode: 'select' }, selection),
        }
    }

    const row = { id: gesture.id, index: gesture.index }

    if (!gesture.toggleKey) {
        const selection = selectOnly(state.query, row)
        return {
            ...selection,
            anchor: anchorAt(row.index, { additive: false, mode: 'select' }, selection),
        }
    }

    // A cmd-click on an already-selected row is a *removal*, and an extension from it
    // should keep removing rather than suddenly start adding.
    const mode = isSelected(state, row) ? 'deselect' : 'select'
    const selection = toggleRow(state, row)
    return {
        ...selection,
        cursor: row.index,
        anchor: anchorAt(row.index, { additive: true, mode }, selection),
    }
}

/** An anchor over `base`, with `base`'s own anchor dropped — see {@link SelectionAnchor.base}. */
const anchorAt = <TQuery>(
    index: number,
    { additive, mode }: { additive: boolean; mode: 'select' | 'deselect' },
    base: BrowseSelectionState<TQuery>,
): SelectionAnchor<TQuery> => ({ index, additive, mode, base: { ...base, anchor: null } })

// ---------------------------------------------------------------------------

const isInRange = (range: SelectionRange, index: number): boolean => index >= range.start && index < range.end

const isInRanges = (ranges: SelectionRange[], index: number): boolean =>
    ranges.some(range => isInRange(range, index))

/** Order the endpoints and reject an empty range, so a click-without-drag is a no-op. */
const normalizeRange = (range: SelectionRange): SelectionRange | null => {
    const start = Math.max(0, Math.min(range.start, range.end))
    const end = Math.max(range.start, range.end)
    return end > start ? { start, end } : null
}

/** Sort and coalesce, so overlapping or touching ranges never double-count a row. */
const mergeRanges = (ranges: SelectionRange[]): SelectionRange[] => {
    const sorted = [...ranges].sort((left, right) => left.start - right.start)
    const merged: SelectionRange[] = []

    for (const range of sorted) {
        const previous = merged[merged.length - 1]
        if (previous && range.start <= previous.end) {
            previous.end = Math.max(previous.end, range.end)
            continue
        }
        merged.push({ ...range })
    }

    return merged
}

/** Cut `hole` out of every range, splitting the ones it lands in the middle of. */
const subtractRange = (ranges: SelectionRange[], hole: SelectionRange): SelectionRange[] =>
    ranges.flatMap(range => {
        if (hole.end <= range.start || hole.start >= range.end) return [range]

        const remainder: SelectionRange[] = []
        if (range.start < hole.start) remainder.push({ start: range.start, end: hole.start })
        if (hole.end < range.end) remainder.push({ start: hole.end, end: range.end })
        return remainder
    })

const restoreInvariants = <TQuery>(state: BrowseSelectionState<TQuery>): BrowseSelectionState<TQuery> => ({
    ...state,
    excluded: state.excluded.filter(row => isInRanges(state.ranges, row.index)),
    included: state.included.filter(row => !isInRanges(state.ranges, row.index)),
})
