import {
    type SelectionRange,
    type SongQuery,
    type SongSelection,
    emptySongSelection,
} from '@release-maestro/core'

/**
 * The browse selection model of
 * [ADR 0004](../../../../../../docs/adr/0004-browse-queries-are-windowed-and-selections-carry-a-query.md).
 *
 * A selection is not a list of songs. `Cmd-A` on a 500k library would otherwise
 * mean serialising 500k ids through structured clone on every change, so a
 * selection carries index ranges within its query's ordering, plus the individual
 * rows added outside them or removed inside them.
 *
 * **Why this file keeps indices the wire format does not.** `SongSelection` carries
 * `excluded`/`included` as bare id arrays, which is all the main process needs to
 * resolve them in SQL. But the renderer has to answer "is this row selected?" and
 * "how many are selected?" without a round trip, and an id alone cannot say whether
 * it falls inside a range. The renderer knows every row's index at the moment the
 * user clicks it, so it keeps them — and {@link toSongSelection} drops them again at
 * the boundary. The invariants below are what make the count exact:
 *
 * - every `excluded` row lies inside some range;
 * - no `included` row lies inside any range;
 * - ranges are disjoint, non-empty and sorted.
 *
 * Every operation here restores those invariants, so
 * `size = Σ range lengths − excluded + included` is always correct.
 */

/** A row the user picked out by hand, with the index it had when they did. */
export interface SelectedRow {
    id: string
    index: number
}

/** The renderer's working selection: {@link SongSelection} plus the indices it elides. */
export interface SongSelectionState {
    /** The filter + sort the {@link ranges} indices are meaningful against. */
    query: SongQuery
    ranges: SelectionRange[]
    /** Rows deselected inside {@link ranges}. */
    excluded: SelectedRow[]
    /** Rows selected outside {@link ranges}. */
    included: SelectedRow[]
}

export const emptySelection = (query: SongQuery): SongSelectionState => ({
    query,
    ranges: [],
    excluded: [],
    included: [],
})

/** Drop the renderer-only indices; this is what crosses IPC and what actions resolve. */
export const toSongSelection = (state: SongSelectionState): SongSelection => ({
    query: state.query,
    ranges: state.ranges,
    excluded: state.excluded.map(row => row.id),
    included: state.included.map(row => row.id),
})

export const isSelected = (state: SongSelectionState, index: number): boolean =>
    isInRanges(state.ranges, index)
        ? !state.excluded.some(row => row.index == index)
        : state.included.some(row => row.index == index)

/**
 * How many rows the selection covers. Exact at any size, and never enumerates a
 * range — the point of the whole model is that `Cmd-A` costs one pair of numbers.
 */
export const selectionSize = (state: SongSelectionState): number =>
    state.ranges.reduce((total, range) => total + range.end - range.start, 0) -
    state.excluded.length +
    state.included.length

export const isEmptySelection = (state: SongSelectionState): boolean => selectionSize(state) == 0

/** Plain click: this row and nothing else. */
export const selectOnly = (query: SongQuery, row: SelectedRow): SongSelectionState => ({
    query,
    ranges: [],
    excluded: [],
    included: [row],
})

/** Cmd-click: flip one row, leaving the rest of the selection alone. */
export const toggleRow = (state: SongSelectionState, row: SelectedRow): SongSelectionState => {
    if (isInRanges(state.ranges, row.index)) {
        const excluded = state.excluded.some(excludedRow => excludedRow.index == row.index)
        return {
            ...state,
            excluded: excluded
                ? state.excluded.filter(excludedRow => excludedRow.index != row.index)
                : [...state.excluded, row],
        }
    }

    const included = state.included.some(includedRow => includedRow.index == row.index)
    return {
        ...state,
        included: included
            ? state.included.filter(includedRow => includedRow.index != row.index)
            : [...state.included, row],
    }
}

/**
 * Shift-click: select `[start, end)`.
 *
 * Non-additive replaces the whole selection, which is what a plain shift-click
 * means everywhere else. `additive` (cmd-shift-click) keeps what was already there
 * and merges the new range in — the multi-range case in the ADR's table.
 */
export const selectRange = (
    state: SongSelectionState,
    range: SelectionRange,
    { additive = false }: { additive?: boolean } = {},
): SongSelectionState => {
    const normalized = normalizeRange(range)
    if (!normalized) return state
    if (!additive) return { query: state.query, ranges: [normalized], excluded: [], included: [] }

    return restoreInvariants({ ...state, ranges: mergeRanges([...state.ranges, normalized]) })
}

/**
 * Where a shift-extension starts from, and what it means.
 *
 * A shift-click is not one gesture — what it does depends on how its anchor was set.
 * After a plain click it *replaces* the selection with the range; after a cmd-click it
 * *adds* a range and leaves everything else alone. That is the difference between
 * "select these ten" and "and also these ten", and it is why the anchor has to
 * remember which kind of click created it.
 */
export interface SelectionAnchor {
    index: number
    /** True when the anchor came from an additive click, so extending adds a range. */
    additive: boolean
    /**
     * The selection as it stood when the anchor was set. Every extension re-applies
     * from here rather than from the current selection, so dragging a range shorter
     * shrinks it instead of leaving the longer one merged underneath.
     */
    base: SongSelectionState
}

/** One click, reduced to what selection semantics actually depend on. */
export interface SelectionGesture {
    index: number
    /** The row's id; only needed for the gestures that name a single row. */
    id: string | null
    shiftKey: boolean
    /** Cmd on macOS, Ctrl elsewhere. */
    toggleKey: boolean
}

export interface SelectionGestureResult {
    selection: SongSelectionState
    anchor: SelectionAnchor | null
}

/**
 * Apply a click to a selection, and report the anchor the next click should use.
 *
 * Kept here rather than in the table because it is selection semantics, not
 * rendering — and because the case matrix is worth testing without a DOM.
 */
export const applySelectionGesture = (
    state: SongSelectionState,
    anchor: SelectionAnchor | null,
    gesture: SelectionGesture,
): SelectionGestureResult => {
    // An anchor from a different query points into an ordering that no longer exists.
    const usableAnchor = anchor && sameQuery(anchor.base.query, state.query) ? anchor : null

    if (gesture.shiftKey && usableAnchor) {
        const start = Math.min(usableAnchor.index, gesture.index)
        const end = Math.max(usableAnchor.index, gesture.index) + 1
        return {
            selection: selectRange(
                usableAnchor.base,
                { start, end },
                { additive: usableAnchor.additive || gesture.toggleKey },
            ),
            // The anchor stays put, so extending again re-measures from the same row.
            anchor: usableAnchor,
        }
    }

    if (gesture.id == null) return { selection: state, anchor: usableAnchor }
    const row = { id: gesture.id, index: gesture.index }

    const selection = gesture.toggleKey ? toggleRow(state, row) : selectOnly(state.query, row)
    return { selection, anchor: { index: gesture.index, additive: gesture.toggleKey, base: selection } }
}

/** Cmd-A: one pair of numbers, whatever the library's size. */
export const selectAll = (query: SongQuery, total: number): SongSelectionState =>
    total <= 0
        ? emptySelection(query)
        : { query, ranges: [{ start: 0, end: total }], excluded: [], included: [] }

/**
 * Reconcile a selection with a refetch.
 *
 * Browse views refetch as a scan ingests songs, and an insert above a selected range
 * silently changes what `[[12, 45)]` refers to — an action would then hit the wrong
 * files. So any selection holding ranges is dropped when the row count changes.
 * Selections made only of ids survive: an id means the same song wherever it moved to.
 */
export const selectionAfterRefetch = (
    state: SongSelectionState,
    previousTotal: number,
    nextTotal: number,
): SongSelectionState => {
    if (previousTotal == nextTotal) return state
    if (state.ranges.length == 0) return state
    return emptySelection(state.query)
}

/**
 * Reconcile a selection with a new query. Index ranges mean nothing against a
 * different ordering, and the ADR treats a filter or sort change as invalidating the
 * selection outright rather than trying to carry part of it across.
 */
export const selectionForQuery = (state: SongSelectionState, query: SongQuery): SongSelectionState =>
    sameQuery(state.query, query) ? state : emptySelection(query)

// ---------------------------------------------------------------------------

const isInRanges = (ranges: SelectionRange[], index: number): boolean =>
    ranges.some(range => index >= range.start && index < range.end)

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

const restoreInvariants = (state: SongSelectionState): SongSelectionState => ({
    ...state,
    excluded: state.excluded.filter(row => isInRanges(state.ranges, row.index)),
    included: state.included.filter(row => !isInRanges(state.ranges, row.index)),
})

/**
 * Structural comparison of two queries. Filters compare by value — an omitted and an
 * empty id list mean the same thing — so a rebuilt-but-equal query does not clear a
 * selection the user can see.
 */
export const sameQuery = (left: SongQuery, right: SongQuery): boolean =>
    left.search == right.search &&
    left.sort.field == right.sort.field &&
    left.sort.direction == right.sort.direction &&
    (left.filter.presence ?? 'any') == (right.filter.presence ?? 'any') &&
    sameIds(left.filter.artistIds, right.filter.artistIds) &&
    sameIds(left.filter.genreIds, right.filter.genreIds) &&
    sameIds(left.filter.recordLabelIds, right.filter.recordLabelIds) &&
    sameIds(left.filter.albumIds, right.filter.albumIds)

const sameIds = (left: string[] | undefined, right: string[] | undefined): boolean => {
    const leftIds = left ?? []
    const rightIds = right ?? []
    return leftIds.length == rightIds.length && leftIds.every((id, index) => id == rightIds[index])
}

/** Re-export so callers building an empty wire selection do not reach past this module. */
export { emptySongSelection }
