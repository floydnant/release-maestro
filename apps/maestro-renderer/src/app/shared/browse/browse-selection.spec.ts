import { emptySongQuery, SongSortField, type SongQuery } from '@release-maestro/core'
import {
    applySelectionGesture,
    deselectRange,
    emptySelection,
    isEmptySelection,
    isSelected,
    selectAll,
    selectOnly,
    selectRange,
    selectionAfterRefetch,
    selectionForQuery,
    selectionSize,
    toggleRow,
    toWireSelection,
    type BrowseSelectionState,
    type SelectionAnchor,
} from './browse-selection'
import { sameQuery } from './song-selection'

const query = emptySongQuery()
const row = (index: number) => ({ id: `song-${index}`, index })
const selectedIndices = (state: BrowseSelectionState<SongQuery>, upTo: number) =>
    Array.from({ length: upTo }, (_value, index) => index).filter(index => isSelected(state, index))

describe('song selection', () => {
    describe('the gestures in ADR 0004', () => {
        it('selects one row on a plain click', () => {
            const state = selectOnly(query, row(12))

            expect(selectionSize(state)).toBe(1)
            expect(selectedIndices(state, 20)).toEqual([12])
            expect(toWireSelection(state)).toMatchObject({ ranges: [], included: ['song-12'] })
        })

        it('replaces the selection on a second plain click', () => {
            const first = selectOnly(query, row(12))
            const second = selectOnly(first.query, row(30))

            expect(selectedIndices(second, 40)).toEqual([30])
        })

        it('accumulates a handful of rows on cmd-click', () => {
            const state = [row(3), row(9), row(14)].reduce(toggleRow, emptySelection(query))

            expect(selectionSize(state)).toBe(3)
            expect(toWireSelection(state).included).toEqual(['song-3', 'song-9', 'song-14'])
        })

        it('deselects an individually selected row on a second cmd-click', () => {
            const state = toggleRow(toggleRow(emptySelection(query), row(3)), row(3))

            expect(isEmptySelection(state)).toBe(true)
            expect(toWireSelection(state).included).toEqual([])
        })

        it('selects a range on shift-click as one pair of numbers', () => {
            const state = selectRange(emptySelection(query), { start: 12, end: 45 })

            expect(selectionSize(state)).toBe(33)
            expect(toWireSelection(state)).toMatchObject({
                ranges: [{ start: 12, end: 45 }],
                included: [],
                excluded: [],
            })
        })

        it('holds several ranges when a range is added additively', () => {
            const first = selectRange(emptySelection(query), { start: 12, end: 45 })
            const state = selectRange(first, { start: 900, end: 1_200 }, { additive: true })

            expect(state.ranges).toEqual([
                { start: 12, end: 45 },
                { start: 900, end: 1_200 },
            ])
            expect(selectionSize(state)).toBe(333)
        })

        it('replaces the selection on a non-additive shift-click', () => {
            const first = selectRange(emptySelection(query), { start: 12, end: 45 })
            const state = selectRange(first, { start: 900, end: 1_200 })

            expect(state.ranges).toEqual([{ start: 900, end: 1_200 }])
        })

        it('selects everything on cmd-A without enumerating a single id', () => {
            const state = selectAll(query, 500_000)

            expect(selectionSize(state)).toBe(500_000)
            const wire = toWireSelection(state)
            expect(wire.ranges).toEqual([{ start: 0, end: 500_000 }])
            expect(wire.included).toEqual([])
            expect(wire.excluded).toEqual([])
        })

        it('records cmd-A minus a few rows as exclusions, not as a shrunken range', () => {
            const all = selectAll(query, 500_000)
            const state = [row(3), row(7), row(11)].reduce(toggleRow, all)

            expect(selectionSize(state)).toBe(499_997)
            expect(toWireSelection(state)).toMatchObject({
                ranges: [{ start: 0, end: 500_000 }],
                excluded: ['song-3', 'song-7', 'song-11'],
            })
            expect(isSelected(state, 7)).toBe(false)
            expect(isSelected(state, 8)).toBe(true)
        })

        it('holds the first and last row of a huge library as two ids', () => {
            const state = [row(0), row(499_999)].reduce(toggleRow, emptySelection(query))

            expect(selectionSize(state)).toBe(2)
            expect(toWireSelection(state).included).toHaveLength(2)
        })
    })

    describe('invariants', () => {
        it('re-selects an excluded row rather than growing the included list', () => {
            const all = selectAll(query, 100)
            const excluded = toggleRow(all, row(5))
            const state = toggleRow(excluded, row(5))

            expect(selectionSize(state)).toBe(100)
            expect(toWireSelection(state)).toMatchObject({ excluded: [], included: [] })
        })

        it('never double-counts a row swallowed by an additive range', () => {
            const picked = toggleRow(emptySelection(query), row(20))
            const state = selectRange(picked, { start: 10, end: 30 }, { additive: true })

            expect(selectionSize(state)).toBe(20)
            expect(toWireSelection(state).included).toEqual([])
        })

        it('drops an exclusion that no longer sits inside any range', () => {
            const ranged = selectRange(emptySelection(query), { start: 0, end: 50 })
            const excluded = toggleRow(ranged, row(5))
            const state = selectRange(excluded, { start: 80, end: 90 }, { additive: true })

            // The [0,50) range is still there, so the exclusion is still meaningful.
            expect(selectionSize(state)).toBe(59)
            expect(toWireSelection(state).excluded).toEqual(['song-5'])
        })

        it('coalesces overlapping ranges instead of counting the overlap twice', () => {
            const first = selectRange(emptySelection(query), { start: 0, end: 20 })
            const state = selectRange(first, { start: 10, end: 30 }, { additive: true })

            expect(state.ranges).toEqual([{ start: 0, end: 30 }])
            expect(selectionSize(state)).toBe(30)
        })

        it('ignores an empty range', () => {
            const state = selectRange(emptySelection(query), { start: 7, end: 7 })

            expect(isEmptySelection(state)).toBe(true)
        })

        it('orders a range selected upwards', () => {
            const state = selectRange(emptySelection(query), { start: 40, end: 10 })

            expect(state.ranges).toEqual([{ start: 10, end: 40 }])
        })
    })

    describe('drift on refetch', () => {
        it('clears a range-holding selection when the row count changes', () => {
            const state = selectRange(emptySelection(query), { start: 12, end: 45 })

            expect(isEmptySelection(selectionAfterRefetch(state, 1_000, 1_001))).toBe(true)
        })

        it('keeps a range-holding selection when the row count is unchanged', () => {
            const state = selectRange(emptySelection(query), { start: 12, end: 45 })

            expect(selectionAfterRefetch(state, 1_000, 1_000)).toBe(state)
        })

        it('keeps an id-only selection across a row count change, because ids do not drift', () => {
            const state = [row(3), row(9)].reduce(toggleRow, emptySelection(query))

            expect(selectionAfterRefetch(state, 1_000, 1_200)).toBe(state)
        })

        it('clears cmd-A-minus-exclusions, since the range underneath it moved', () => {
            const state = toggleRow(selectAll(query, 1_000), row(5))

            expect(isEmptySelection(selectionAfterRefetch(state, 1_000, 999))).toBe(true)
        })
    })

    describe('drift on query change', () => {
        it('clears when the sort changes', () => {
            const state = selectRange(emptySelection(query), { start: 0, end: 10 })
            const resorted: SongQuery = {
                ...query,
                sort: { field: SongSortField.title, direction: 'asc' },
            }

            expect(isEmptySelection(selectionForQuery(state, resorted, sameQuery))).toBe(true)
        })

        it('clears when the filter changes', () => {
            const state = selectRange(emptySelection(query), { start: 0, end: 10 })
            const filtered: SongQuery = { ...query, filter: { artistIds: ['artist-1'] } }

            expect(isEmptySelection(selectionForQuery(state, filtered, sameQuery))).toBe(true)
        })

        it('survives a rebuilt but equal query', () => {
            const state = selectRange(emptySelection(query), { start: 0, end: 10 })

            expect(selectionForQuery(state, emptySongQuery(), sameQuery)).toBe(state)
        })

        it('treats an omitted and an empty id list as the same filter', () => {
            const state = selectRange(emptySelection(query), { start: 0, end: 10 })
            const equivalent: SongQuery = { ...query, filter: { artistIds: [], genreIds: [] } }

            expect(selectionForQuery(state, equivalent, sameQuery)).toBe(state)
        })
    })

    describe('click gestures and the anchor', () => {
        const click = (
            state: BrowseSelectionState<SongQuery>,
            anchor: SelectionAnchor<SongQuery> | null,
            index: number,
            keys: { shiftKey?: boolean; toggleKey?: boolean } = {},
        ) =>
            applySelectionGesture(
                state,
                anchor,
                {
                    index,
                    id: `song-${index}`,
                    shiftKey: keys.shiftKey ?? false,
                    toggleKey: keys.toggleKey ?? false,
                },
                sameQuery,
            )

        it('replaces the selection when shift follows a plain click', () => {
            const first = click(emptySelection(query), null, 5)
            const extended = click(first.selection, first.anchor, 10, { shiftKey: true })

            expect(extended.selection.ranges).toEqual([{ start: 5, end: 11 }])
            expect(selectionSize(extended.selection)).toBe(6)
        })

        it('shrinks the range when shift-clicking back towards the anchor', () => {
            const first = click(emptySelection(query), null, 5)
            const long = click(first.selection, first.anchor, 20, { shiftKey: true })
            const short = click(long.selection, long.anchor, 8, { shiftKey: true })

            // Re-measured from the anchor's base, so the longer range is gone rather
            // than left merged underneath the shorter one.
            expect(short.selection.ranges).toEqual([{ start: 5, end: 9 }])
        })

        it('keeps an existing range when shift follows a cmd-click', () => {
            // The reported bug: this used to throw the first range away.
            const first = click(emptySelection(query), null, 5)
            const range = click(first.selection, first.anchor, 10, { shiftKey: true })
            const picked = click(range.selection, range.anchor, 40, { toggleKey: true })
            const second = click(picked.selection, picked.anchor, 45, { shiftKey: true })

            expect(second.selection.ranges).toEqual([
                { start: 5, end: 11 },
                { start: 40, end: 46 },
            ])
            expect(selectionSize(second.selection)).toBe(12)
        })

        it('re-measures the second range without disturbing the first', () => {
            const first = click(emptySelection(query), null, 5)
            const range = click(first.selection, first.anchor, 10, { shiftKey: true })
            const picked = click(range.selection, range.anchor, 40, { toggleKey: true })
            const long = click(picked.selection, picked.anchor, 60, { shiftKey: true })
            const short = click(long.selection, long.anchor, 43, { shiftKey: true })

            expect(short.selection.ranges).toEqual([
                { start: 5, end: 11 },
                { start: 40, end: 44 },
            ])
        })

        it('never double-counts the cmd-clicked row once its range swallows it', () => {
            const picked = click(emptySelection(query), null, 40, { toggleKey: true })
            const extended = click(picked.selection, picked.anchor, 45, { shiftKey: true })

            expect(selectionSize(extended.selection)).toBe(6)
            expect(toWireSelection(extended.selection).included).toEqual([])
        })

        it('adds a range on cmd-shift-click even when the anchor came from a plain click', () => {
            const first = click(emptySelection(query), null, 5)
            const range = click(first.selection, first.anchor, 10, { shiftKey: true })
            const added = click(range.selection, range.anchor, 40, { shiftKey: true, toggleKey: true })

            // Extending additively from the same anchor grows the one range rather
            // than leaving a second, overlapping one behind.
            expect(added.selection.ranges).toEqual([{ start: 5, end: 41 }])
        })

        it('starts over when a plain click follows a range', () => {
            const first = click(emptySelection(query), null, 5)
            const range = click(first.selection, first.anchor, 10, { shiftKey: true })
            const plain = click(range.selection, range.anchor, 30)

            expect(plain.selection.ranges).toEqual([])
            expect(toWireSelection(plain.selection).included).toEqual(['song-30'])
        })

        it('ignores an anchor left over from a different query', () => {
            const first = click(emptySelection(query), null, 5)
            const stale = first.anchor
            const resorted = { ...query, sort: { field: SongSortField.title, direction: 'asc' as const } }

            const extended = click(emptySelection(resorted), stale, 10, { shiftKey: true })

            // Falls back to selecting the clicked row rather than extending across an
            // ordering the anchor's indices no longer describe.
            expect(extended.selection.ranges).toEqual([])
            expect(toWireSelection(extended.selection).included).toEqual(['song-10'])
        })
    })

    describe('a fresh range normalises what it covers', () => {
        it('re-includes rows that were excluded inside it', () => {
            // Reported: select a range, punch holes in it, then draw a wider range over
            // the lot — the holes used to survive.
            const ranged = selectRange(emptySelection(query), { start: 10, end: 20 })
            const holed = [row(12), row(15)].reduce(toggleRow, ranged)
            expect(selectionSize(holed)).toBe(8)

            const rewrapped = selectRange(holed, { start: 5, end: 30 }, { additive: true })

            expect(rewrapped.ranges).toEqual([{ start: 5, end: 30 }])
            expect(toWireSelection(rewrapped).excluded).toEqual([])
            expect(selectionSize(rewrapped)).toBe(25)
        })

        it('leaves exclusions alone when they sit in a range the new one does not touch', () => {
            const first = selectRange(emptySelection(query), { start: 0, end: 10 })
            const holed = toggleRow(first, row(3))
            const second = selectRange(holed, { start: 50, end: 60 }, { additive: true })

            expect(toWireSelection(second).excluded).toEqual(['song-3'])
            expect(selectionSize(second)).toBe(19)
        })

        it('absorbs a hand-picked row the new range covers instead of counting it twice', () => {
            const picked = toggleRow(emptySelection(query), row(15))
            const ranged = selectRange(picked, { start: 10, end: 20 }, { additive: true })

            expect(selectionSize(ranged)).toBe(10)
            expect(toWireSelection(ranged).included).toEqual([])
        })
    })

    describe('deselecting a range', () => {
        it('cuts a hole in the middle of a range without enumerating rows', () => {
            const all = selectAll(query, 100_000)
            const state = deselectRange(all, { start: 10, end: 90_000 })

            expect(state.ranges).toEqual([
                { start: 0, end: 10 },
                { start: 90_000, end: 100_000 },
            ])
            expect(selectionSize(state)).toBe(10_010)
            // The whole point: a 90k-row removal still costs two pairs of numbers.
            expect(toWireSelection(state).excluded).toEqual([])
        })

        it('trims a range it only overlaps at one end', () => {
            const ranged = selectRange(emptySelection(query), { start: 10, end: 20 })
            const state = deselectRange(ranged, { start: 15, end: 40 })

            expect(state.ranges).toEqual([{ start: 10, end: 15 }])
        })

        it('removes a range it covers entirely', () => {
            const ranged = selectRange(emptySelection(query), { start: 10, end: 20 })
            const state = deselectRange(ranged, { start: 0, end: 100 })

            expect(isEmptySelection(state)).toBe(true)
        })

        it('drops hand-picked rows that fall inside it', () => {
            const picked = [row(5), row(50)].reduce(toggleRow, emptySelection(query))
            const state = deselectRange(picked, { start: 0, end: 10 })

            expect(toWireSelection(state).included).toEqual(['song-50'])
        })

        it('leaves an untouched range alone', () => {
            const ranged = selectRange(emptySelection(query), { start: 10, end: 20 })
            const state = deselectRange(ranged, { start: 30, end: 40 })

            expect(state.ranges).toEqual([{ start: 10, end: 20 }])
        })

        it('is a no-op for an empty span', () => {
            const ranged = selectRange(emptySelection(query), { start: 10, end: 20 })

            expect(deselectRange(ranged, { start: 15, end: 15 })).toBe(ranged)
        })
    })

    describe('the inverse gesture', () => {
        const click = (
            state: BrowseSelectionState<SongQuery>,
            anchor: SelectionAnchor<SongQuery> | null,
            index: number,
            keys: { shiftKey?: boolean; toggleKey?: boolean } = {},
        ) =>
            applySelectionGesture(
                state,
                anchor,
                {
                    index,
                    id: `song-${index}`,
                    shiftKey: keys.shiftKey ?? false,
                    toggleKey: keys.toggleKey ?? false,
                },
                sameQuery,
            )

        it('deselects a span when cmd-shift extends from a row cmd-clicked off', () => {
            // Reported: the same pattern should work in reverse.
            const ranged = selectRange(emptySelection(query), { start: 0, end: 20 })
            const removed = click(ranged, null, 5, { toggleKey: true })
            expect(removed.anchor?.mode).toBe('deselect')

            const span = click(removed.selection, removed.anchor, 9, { shiftKey: true, toggleKey: true })

            expect(span.selection.ranges).toEqual([
                { start: 0, end: 5 },
                { start: 10, end: 20 },
            ])
            expect(selectionSize(span.selection)).toBe(15)
        })

        it('keeps adding when the cmd-click landed on an unselected row', () => {
            const ranged = selectRange(emptySelection(query), { start: 0, end: 10 })
            const added = click(ranged, null, 50, { toggleKey: true })
            expect(added.anchor?.mode).toBe('select')

            const span = click(added.selection, added.anchor, 55, { shiftKey: true })

            expect(span.selection.ranges).toEqual([
                { start: 0, end: 10 },
                { start: 50, end: 56 },
            ])
        })

        it('re-measures a deselection when the extension is dragged back', () => {
            const ranged = selectRange(emptySelection(query), { start: 0, end: 20 })
            const removed = click(ranged, null, 5, { toggleKey: true })
            const wide = click(removed.selection, removed.anchor, 15, { shiftKey: true })
            const narrow = click(wide.selection, wide.anchor, 7, { shiftKey: true })

            // Re-applied from the anchor's base, so the wider hole is gone.
            expect(narrow.selection.ranges).toEqual([
                { start: 0, end: 5 },
                { start: 8, end: 20 },
            ])
        })

        it('deselects a single row when the extension does not move', () => {
            const ranged = selectRange(emptySelection(query), { start: 0, end: 20 })
            const removed = click(ranged, null, 5, { toggleKey: true })
            const span = click(removed.selection, removed.anchor, 5, { shiftKey: true })

            expect(isSelected(span.selection, 5)).toBe(false)
            expect(selectionSize(span.selection)).toBe(19)
        })
    })

    describe('gesture edge cases', () => {
        const click = (
            state: BrowseSelectionState<SongQuery>,
            anchor: SelectionAnchor<SongQuery> | null,
            index: number,
            keys: { shiftKey?: boolean; toggleKey?: boolean; id?: string | null } = {},
        ) =>
            applySelectionGesture(
                state,
                anchor,
                {
                    index,
                    id: keys.id === undefined ? `song-${index}` : keys.id,
                    shiftKey: keys.shiftKey ?? false,
                    toggleKey: keys.toggleKey ?? false,
                },
                sameQuery,
            )

        it('treats a shift-click with no anchor as a plain click', () => {
            const state = click(emptySelection(query), null, 7, { shiftKey: true })

            expect(toWireSelection(state.selection).included).toEqual(['song-7'])
            expect(state.anchor).toMatchObject({ index: 7, additive: false, mode: 'select' })
        })

        it('extends backwards from the anchor', () => {
            const first = click(emptySelection(query), null, 20)
            const back = click(first.selection, first.anchor, 10, { shiftKey: true })

            expect(back.selection.ranges).toEqual([{ start: 10, end: 21 }])
        })

        it('keeps the anchor across repeated extensions', () => {
            const first = click(emptySelection(query), null, 10)
            const once = click(first.selection, first.anchor, 20, { shiftKey: true })
            const twice = click(once.selection, once.anchor, 30, { shiftKey: true })

            expect(twice.anchor?.index).toBe(10)
            expect(twice.selection.ranges).toEqual([{ start: 10, end: 31 }])
        })

        it('does nothing when a row-naming gesture arrives without an id', () => {
            const first = click(emptySelection(query), null, 5)
            const nothing = click(first.selection, first.anchor, 9, { id: null })

            expect(nothing.selection).toBe(first.selection)
            expect(nothing.anchor).toBe(first.anchor)
        })

        it('still extends without an id, because a range needs only indices', () => {
            const first = click(emptySelection(query), null, 5)
            const extended = click(first.selection, first.anchor, 9, { shiftKey: true, id: null })

            expect(extended.selection.ranges).toEqual([{ start: 5, end: 10 }])
        })

        it('drops an anchor whose base belongs to a different query', () => {
            const first = click(emptySelection(query), null, 5)
            const resorted: SongQuery = {
                ...query,
                sort: { field: SongSortField.title, direction: 'asc' },
            }

            const extended = click(emptySelection(resorted), first.anchor, 10, { shiftKey: true })

            expect(extended.selection.ranges).toEqual([])
            expect(toWireSelection(extended.selection).included).toEqual(['song-10'])
        })

        it('toggles a row back on with a second cmd-click, and flips the anchor with it', () => {
            const off = click(selectRange(emptySelection(query), { start: 0, end: 10 }), null, 4, {
                toggleKey: true,
            })
            const on = click(off.selection, off.anchor, 4, { toggleKey: true })

            expect(isSelected(on.selection, 4)).toBe(true)
            expect(on.anchor?.mode).toBe('select')
        })

        it('selects a single row when cmd-A runs on an empty library', () => {
            expect(isEmptySelection(selectAll(query, 0))).toBe(true)
        })
    })
})
