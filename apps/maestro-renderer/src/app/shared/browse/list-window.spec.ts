import { listIndexAt, listRowTop, listWindowAt } from './list-window'

describe('grouped list geometry', () => {
    const groups = [0, 2]

    it('adds space at disc boundaries while keeping ordinary songs compact', () => {
        expect([0, 1, 2, 3].map(index => listRowTop(index, groups))).toEqual([0, 64, 104, 168])
        expect([0, 23, 24, 63, 64, 103, 104, 127, 128, 167].map(top => listIndexAt(top, groups))).toEqual([
            0, 0, 0, 0, 1, 1, 2, 2, 2, 2,
        ])
    })

    it('finds a bounded window deep in a large album, including after a disc heading', () => {
        const groups = [0, 250_000]
        const start = listRowTop(250_010, groups)
        expect(listWindowAt(start, 800, groups)).toEqual({ offset: 249_990, limit: 60 })
        expect(listRowTop(500_000, groups)).toBe(20_000_048)
    })

    it('preserves ungrouped geometry', () => {
        expect(listRowTop(100)).toBe(4000)
        expect(listWindowAt(4000, 800)).toEqual({ offset: 80, limit: 60 })
    })
})
