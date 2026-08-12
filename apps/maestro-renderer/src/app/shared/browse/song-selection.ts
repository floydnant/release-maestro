import { type SongFilter, type SongQuery, type SongSelection } from '@release-maestro/core'
import {
    applySelectionGesture,
    selectionForQuery,
    toWireSelection,
    type BrowseSelectionState,
    type SelectionAnchor,
    type SelectionGesture,
} from './browse-selection'
import { sameIds } from './query-params.utils'

/**
 * Songs bound to the generic browse selection mechanics in `browse-selection.ts`.
 *
 * This module is deliberately tiny: it supplies the query comparator and the wire
 * type, and nothing else. Albums, artists, record labels and genres each get a file
 * this size rather than their own copy of the selection rules.
 */

export type SongSelectionState = BrowseSelectionState<SongQuery>
export type SongSelectionAnchor = SelectionAnchor<SongQuery>

export {
    clearSelection,
    deselectRange,
    emptySelection,
    isEmptySelection,
    isSelected,
    isSelectionModifierHeld,
    NO_CURSOR,
    selectAll,
    selectOnly,
    selectRange,
    selectionAfterRefetch,
    selectionGestureFrom,
    selectionSize,
    toggleRow,
    type SelectedRow,
    type SelectionGesture,
} from './browse-selection'

/**
 * Structural comparison of two song queries. Filters compare by value — an omitted and
 * an empty id list mean the same thing — so a rebuilt-but-equal query does not clear a
 * selection the user can see.
 */
export const sameQuery = (left: SongQuery, right: SongQuery): boolean =>
    left.search == right.search &&
    left.sort.field == right.sort.field &&
    left.sort.direction == right.sort.direction &&
    sameFilter(left.filter, right.filter)

/**
 * Structural comparison of two filters, on the same terms.
 *
 * Separate from {@link sameQuery} because the filter is the only part of a query the
 * chip names depend on: a sort click rebuilds the query object, and identity equality
 * would send that rebuilt-but-equal filter back over IPC to resolve names nobody
 * asked to change.
 */
export const sameFilter = (left: SongFilter, right: SongFilter): boolean =>
    (left.presence ?? 'any') == (right.presence ?? 'any') &&
    sameIds(left.artistIds, right.artistIds) &&
    sameIds(left.genreIds, right.genreIds) &&
    sameIds(left.recordLabelIds, right.recordLabelIds) &&
    sameIds(left.albumIds, right.albumIds)

/** Drop the renderer-only indices; this is what crosses IPC and what actions resolve. */
export const toSongSelection = (state: SongSelectionState): SongSelection => toWireSelection(state)

export const selectionForSongQuery = (state: SongSelectionState, query: SongQuery): SongSelectionState =>
    selectionForQuery(state, query, sameQuery)

export const applySongSelectionGesture = (
    state: SongSelectionState,
    gesture: SelectionGesture,
): SongSelectionState => applySelectionGesture(state, gesture, sameQuery)
