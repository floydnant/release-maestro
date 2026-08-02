import { DEFAULT_SONG_SORT, SongPresence, SongSortField, emptySongQuery } from '@release-maestro/core'
import { nextSort, songQueryFromParams, songQueryToParams } from './song-query-params'

describe('song query params', () => {
    describe('reading a URL', () => {
        it('falls back to the default query when there are no params', () => {
            expect(songQueryFromParams({})).toEqual(emptySongQuery())
        })

        it('reads sort, direction and search', () => {
            const query = songQueryFromParams({ sort: 'bpm', dir: 'asc', q: 'burial' })

            expect(query.sort).toEqual({ field: SongSortField.bpm, direction: 'asc' })
            expect(query.search).toBe('burial')
        })

        it('reads entity filters as comma-separated id lists', () => {
            const query = songQueryFromParams({ artist: 'a1,a2', genre: 'g1', label: 'l1', release: 'r1' })

            expect(query.filter).toEqual({
                artistIds: ['a1', 'a2'],
                genreIds: ['g1'],
                recordLabelIds: ['l1'],
                albumIds: ['r1'],
            })
        })

        it('reads the presence scope', () => {
            expect(songQueryFromParams({ presence: 'missing' }).filter.presence).toBe(SongPresence.missing)
        })

        it.each([
            ['an unknown sort field', { sort: 'loudness' }],
            ['an unknown direction', { sort: 'bpm', dir: 'sideways' }],
            ['an unknown presence', { presence: 'perhaps' }],
        ])('falls back rather than failing on %s', (_case, params) => {
            const query = songQueryFromParams(params)

            expect(SongSortField[query.sort.field]).toBeDefined()
            expect(query.filter.presence).toBeUndefined()
        })

        it('ignores blank and duplicated ids', () => {
            expect(songQueryFromParams({ artist: 'a1, ,a1,a2,' }).filter.artistIds).toEqual(['a1', 'a2'])
        })

        it('drops a filter whose value is empty, so it compares equal to no filter', () => {
            expect(songQueryFromParams({ artist: '', genre: ' ' }).filter).toEqual({})
        })

        it('takes the first value when the router hands back a repeated param', () => {
            expect(songQueryFromParams({ q: ['first', 'second'] }).search).toBe('first')
        })
    })

    describe('writing a URL', () => {
        it('writes nothing for the default query', () => {
            const params = songQueryToParams(emptySongQuery())

            expect(Object.values(params).every(value => value == null)).toBe(true)
        })

        it('clears its own params rather than leaving a stale filter behind', () => {
            const withFilter = { ...emptySongQuery(), filter: { artistIds: ['a1'] } }
            const cleared = songQueryToParams({ ...withFilter, filter: {} })

            expect(cleared).toHaveProperty('artist', null)
        })

        it('writes the direction whenever the sort column is not the default one', () => {
            const params = songQueryToParams({
                ...emptySongQuery(),
                sort: { field: SongSortField.title, direction: DEFAULT_SONG_SORT.direction },
            })

            expect(params).toMatchObject({ sort: 'title', dir: DEFAULT_SONG_SORT.direction })
        })

        it('writes the direction when the default column is sorted the other way', () => {
            const params = songQueryToParams({
                ...emptySongQuery(),
                sort: { field: DEFAULT_SONG_SORT.field, direction: 'asc' },
            })

            expect(params).toMatchObject({ sort: null, dir: 'asc' })
        })

        it('round-trips a fully populated query', () => {
            const query = {
                search: 'moth',
                sort: { field: SongSortField.bpm, direction: 'asc' as const },
                filter: {
                    artistIds: ['a1', 'a2'],
                    genreIds: ['g1'],
                    recordLabelIds: ['l1'],
                    albumIds: ['r1'],
                    presence: SongPresence.present,
                },
            }

            const params = songQueryToParams(query)
            const roundTripped = songQueryFromParams(
                Object.fromEntries(
                    Object.entries(params).filter(([, value]) => value != null) as [string, string][],
                ),
            )

            expect(roundTripped).toEqual(query)
        })
    })

    describe('nextSort', () => {
        it('flips the direction when the same column is clicked again', () => {
            expect(nextSort({ field: SongSortField.title, direction: 'asc' }, SongSortField.title)).toEqual({
                field: SongSortField.title,
                direction: 'desc',
            })
        })

        it.each([
            [SongSortField.title, 'asc'],
            [SongSortField.artist, 'asc'],
            [SongSortField.bpm, 'desc'],
            [SongSortField.year, 'desc'],
            [SongSortField.dateAdded, 'desc'],
        ])('starts %s in its natural direction', (field, expected) => {
            expect(nextSort({ field: SongSortField.genre, direction: 'asc' }, field).direction).toBe(expected)
        })
    })
})
