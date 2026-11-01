import { reloadFeedItemsRequestSchema } from './feed.schema'

describe('reload feed item request boundary', () => {
    it('accepts a bounded list of item IDs', () => {
        expect(reloadFeedItemsRequestSchema.parse({ ids: ['first', 'second'] })).toEqual({
            ids: ['first', 'second'],
        })
    })
    it.each([
        {},
        { ids: [] },
        { ids: [''] },
        { ids: [1] },
        { ids: Array(21).fill('item') },
        { ids: ['x'.repeat(201)] },
    ])('rejects malformed or unbounded batches: %j', request => {
        expect(reloadFeedItemsRequestSchema.safeParse(request).success).toBe(false)
    })
})
