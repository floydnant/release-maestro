import { genreQueryFromParams, genreQueryToParams } from './genre-query-params'

describe('genre query URLs', () => {
    it('defaults invalid sorts and handles repeated query values', () => {
        expect(genreQueryFromParams({ sort: 'songCount', dir: 'bad', q: ['Ambient', 'Dub'] })).toEqual({
            search: 'Ambient',
            sort: { field: 'name', direction: 'asc' },
        })
    })
    it('round trips a search and descending order, clearing default values', () => {
        const query = genreQueryFromParams({ q: 'Techno; Ambient', dir: 'desc' })
        expect(genreQueryFromParams(genreQueryToParams(query))).toEqual(query)
        expect(genreQueryToParams(genreQueryFromParams({}))).toEqual({ q: null, sort: null, dir: null })
    })
})
