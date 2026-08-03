import { type SongQuery, type SongSelection } from '@release-maestro/core'
import {
    applySelectionGesture,
    selectionForQuery,
    toWireSelection,
    type BrowseSelectionState,
    type SelectionAnchor,
    type SelectionGesture,
    type SelectionGestureResult,
} from './browse-selection'

/**
 * Songs bound to the generic browse selection mechanics in `browse-selection.ts`.
 *
 * This module is deliberately tiny: it supplies the query comparator and the wire
 * type, and nothing else. Releases, artists, record labels and genres each get a file
 * this size rather than their own copy of the selection rules.
 */

export type SongSelectionState = BrowseSelectionState<SongQuery>
export type SongSelectionAnchor = SelectionAnchor<SongQuery>

export {
    anchorAfterRefetch,
    clearSelection,
    deselectRange,
    emptySelection,
    isEmptySelection,
    isSelected,
    isSelectionModifierHeld,
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

/** Drop the renderer-only indices; this is what crosses IPC and what actions resolve. */
export const toSongSelection = (state: SongSelectionState): SongSelection => toWireSelection(state)

export const selectionForSongQuery = (state: SongSelectionState, query: SongQuery): SongSelectionState =>
    selectionForQuery(state, query, sameQuery)

export const applySongSelectionGesture = (
    state: SongSelectionState,
    anchor: SongSelectionAnchor | null,
    gesture: SelectionGesture,
): SelectionGestureResult<SongQuery> => applySelectionGesture(state, anchor, gesture, sameQuery)
