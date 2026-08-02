import { emptySongQuery, SongSortField, type SongQuery } from '@release-maestro/core'
import {
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
    toSongSelection,
    type SongSelectionState,
} from './song-selection'

const query = emptySongQuery()
const row = (index: number) => ({ id: `song-${index}`, index })
const selectedIndices = (state: SongSelectionState, upTo: number) =>
    Array.from({ length: upTo }, (_value, index) => index).filter(index => isSelected(state, index))

describe('song selection', () => {
    describe('the gestures in ADR 0004', () => {
        it('selects one row on a plain click', () => {
            const state = selectOnly(query, row(12))

            expect(selectionSize(state)).toBe(1)
            expect(selectedIndices(state, 20)).toEqual([12])
            expect(toSongSelection(state)).toMatchObject({ ranges: [], included: ['song-12'] })
        })

        it('replaces the selection on a second plain click', () => {
            const first = selectOnly(query, row(12))
            const second = selectOnly(first.query, row(30))

            expect(selectedIndices(second, 40)).toEqual([30])
        })

        it('accumulates a handful of rows on cmd-click', () => {
            const state = [row(3), row(9), row(14)].reduce(toggleRow, emptySelection(query))

            expect(selectionSize(state)).toBe(3)
            expect(toSongSelection(state).included).toEqual(['song-3', 'song-9', 'song-14'])
        })

        it('deselects an individually selected row on a second cmd-click', () => {
            const state = toggleRow(toggleRow(emptySelection(query), row(3)), row(3))

            expect(isEmptySelection(state)).toBe(true)
            expect(toSongSelection(state).included).toEqual([])
        })

        it('selects a range on shift-click as one pair of numbers', () => {
            const state = selectRange(emptySelection(query), { start: 12, end: 45 })

            expect(selectionSize(state)).toBe(33)
            expect(toSongSelection(state)).toMatchObject({
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
            const wire = toSongSelection(state)
            expect(wire.ranges).toEqual([{ start: 0, end: 500_000 }])
            expect(wire.included).toEqual([])
            expect(wire.excluded).toEqual([])
        })

        it('records cmd-A minus a few rows as exclusions, not as a shrunken range', () => {
            const all = selectAll(query, 500_000)
            const state = [row(3), row(7), row(11)].reduce(toggleRow, all)

            expect(selectionSize(state)).toBe(499_997)
            expect(toSongSelection(state)).toMatchObject({
                ranges: [{ start: 0, end: 500_000 }],
                excluded: ['song-3', 'song-7', 'song-11'],
            })
            expect(isSelected(state, 7)).toBe(false)
            expect(isSelected(state, 8)).toBe(true)
        })

        it('holds the first and last row of a huge library as two ids', () => {
            const state = [row(0), row(499_999)].reduce(toggleRow, emptySelection(query))

            expect(selectionSize(state)).toBe(2)
            expect(toSongSelection(state).included).toHaveLength(2)
        })
    })

    describe('invariants', () => {
        it('re-selects an excluded row rather than growing the included list', () => {
            const all = selectAll(query, 100)
            const excluded = toggleRow(all, row(5))
            const state = toggleRow(excluded, row(5))

            expect(selectionSize(state)).toBe(100)
            expect(toSongSelection(state)).toMatchObject({ excluded: [], included: [] })
        })

        it('never double-counts a row swallowed by an additive range', () => {
            const picked = toggleRow(emptySelection(query), row(20))
            const state = selectRange(picked, { start: 10, end: 30 }, { additive: true })

            expect(selectionSize(state)).toBe(20)
            expect(toSongSelection(state).included).toEqual([])
        })

        it('drops an exclusion that no longer sits inside any range', () => {
            const ranged = selectRange(emptySelection(query), { start: 0, end: 50 })
            const excluded = toggleRow(ranged, row(5))
            const state = selectRange(excluded, { start: 80, end: 90 }, { additive: true })

            // The [0,50) range is still there, so the exclusion is still meaningful.
            expect(selectionSize(state)).toBe(59)
            expect(toSongSelection(state).excluded).toEqual(['song-5'])
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

            expect(isEmptySelection(selectionForQuery(state, resorted))).toBe(true)
        })

        it('clears when the filter changes', () => {
            const state = selectRange(emptySelection(query), { start: 0, end: 10 })
            const filtered: SongQuery = { ...query, filter: { artistIds: ['artist-1'] } }

            expect(isEmptySelection(selectionForQuery(state, filtered))).toBe(true)
        })

        it('survives a rebuilt but equal query', () => {
            const state = selectRange(emptySelection(query), { start: 0, end: 10 })

            expect(selectionForQuery(state, emptySongQuery())).toBe(state)
        })

        it('treats an omitted and an empty id list as the same filter', () => {
            const state = selectRange(emptySelection(query), { start: 0, end: 10 })
            const equivalent: SongQuery = { ...query, filter: { artistIds: [], genreIds: [] } }

            expect(selectionForQuery(state, equivalent)).toBe(state)
        })
    })
})
