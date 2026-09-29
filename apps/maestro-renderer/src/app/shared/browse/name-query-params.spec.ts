import { nameQueryFromParams, nameQueryToParams } from './name-query-params'

describe('name-sorted list query URLs', () => {
    it('defaults invalid sorts and handles repeated query values', () => {
        expect(nameQueryFromParams({ sort: 'songCount', dir: 'bad', q: ['Ambient', 'Dub'] })).toEqual({
            search: 'Ambient',
            sort: { field: 'name', direction: 'asc' },
        })
    })
    it('round trips a search and descending order, clearing default values', () => {
        const query = nameQueryFromParams({ q: 'Techno; Ambient', dir: 'desc' })
        expect(nameQueryFromParams(nameQueryToParams(query))).toEqual(query)
        expect(nameQueryToParams(nameQueryFromParams({}))).toEqual({ q: null, sort: null, dir: null })
    })
})
