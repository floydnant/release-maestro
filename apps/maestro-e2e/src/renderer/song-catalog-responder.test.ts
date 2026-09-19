import { describe, expect, it } from '@jest/globals'
import { emptySongQuery } from '@release-maestro/core'
import { songCatalogResponder } from './scenario-harness'

describe('songCatalogResponder', () => {
    it.each([
        { name: 'negative offset', offset: -2, limit: 2, expectedOffset: 0, titles: ['Row 0', 'Row 1'] },
        { name: 'window past the end', offset: 3, limit: 10, expectedOffset: 3, titles: ['Row 3', 'Row 4'] },
        { name: 'offset at the end', offset: 5, limit: 2, expectedOffset: 5, titles: [] },
        { name: 'offset past the end', offset: 20, limit: 2, expectedOffset: 5, titles: [] },
        { name: 'zero limit', offset: 2, limit: 0, expectedOffset: 2, titles: [] },
        { name: 'negative limit', offset: 2, limit: -1, expectedOffset: 2, titles: [] },
    ])('clamps $name', async ({ offset, limit, expectedOffset, titles }) => {
        const result = await songCatalogResponder(5)({ query: emptySongQuery(), window: { offset, limit } })
        expect(result).toMatchObject({ offset: expectedOffset, total: 5 })
        expect(result.rows.map(row => row.title)).toEqual(titles)
    })

    it('serves an empty catalog', async () => {
        const result = await songCatalogResponder(0)({
            query: emptySongQuery(),
            window: { offset: 10, limit: 3 },
        })
        expect(result).toEqual({ rows: [], offset: 0, total: 0 })
    })

    it('uses absolute catalog indices for row identity, path, and title', async () => {
        const respond = songCatalogResponder(100)
        const result = await respond({ query: emptySongQuery(), window: { offset: 40, limit: 3 } })
        expect(result).toMatchObject({
            offset: 40,
            total: 100,
            rows: [
                { id: 'song-40', path: '/scenario/music/row-40.mp3', title: 'Row 40' },
                { id: 'song-41', path: '/scenario/music/row-41.mp3', title: 'Row 41' },
                { id: 'song-42', path: '/scenario/music/row-42.mp3', title: 'Row 42' },
            ],
        })
        const overlapping = await respond({ query: emptySongQuery(), window: { offset: 41, limit: 1 } })
        expect(overlapping.rows).toEqual([result.rows[1]])
    })
})
