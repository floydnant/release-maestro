import { AlbumSortField, DEFAULT_ALBUM_SORT, emptyAlbumQuery } from '@release-maestro/core'
import {
    albumQueryFromParams,
    albumQueryToParams,
    nextAlbumSort,
    sameAlbumFilter,
    sameAlbumQuery,
} from './album-query-params'

/** Whichever way the default column is *not* sorted, so these do not rot when it changes. */
const OTHER_DIRECTION = DEFAULT_ALBUM_SORT.direction == 'asc' ? 'desc' : 'asc'

describe('album query params', () => {
    describe('reading a URL', () => {
        it('falls back to the default query when there are no params', () => {
            expect(albumQueryFromParams({})).toEqual(emptyAlbumQuery())
        })

        it('reads sort, direction and search', () => {
            const query = albumQueryFromParams({ sort: 'year', dir: 'asc', q: 'untrue' })

            expect(query.sort).toEqual({ field: AlbumSortField.year, direction: 'asc' })
            expect(query.search).toBe('untrue')
        })

        it('reads entity filters as comma-separated id lists', () => {
            const query = albumQueryFromParams({
                albumArtist: 'a1,a2',
                recordLabel: 'l1',
                genre: 'g1',
            })

            expect(query.filter).toEqual({
                albumArtistIds: ['a1', 'a2'],
                recordLabelIds: ['l1'],
                genreIds: ['g1'],
            })
        })

        it.each([
            ['an unknown sort field', { sort: 'loudness' }],
            ['an unknown direction', { sort: 'year', dir: 'sideways' }],
        ])('falls back rather than failing on %s', (_case, params) => {
            expect(AlbumSortField[albumQueryFromParams(params).sort.field]).toBeDefined()
        })

        it('ignores blank and duplicated ids', () => {
            expect(albumQueryFromParams({ albumArtist: 'a1, ,a1,a2,' }).filter.albumArtistIds).toEqual([
                'a1',
                'a2',
            ])
        })

        it('drops a filter whose value is empty, so it compares equal to no filter', () => {
            expect(albumQueryFromParams({ albumArtist: '', genre: ' ' }).filter).toEqual({})
        })

        it('takes the first value when the router hands back a repeated param', () => {
            expect(albumQueryFromParams({ q: ['first', 'second'] }).search).toBe('first')
        })

        it('reads the track list’s artist param as no filter, because it means something else', () => {
            // `artist` on the track list means "played on this track". An album's filter
            // is about being credited as its album artist, which is a different claim, so
            // the key is deliberately not shared.
            expect(albumQueryFromParams({ artist: 'a1' }).filter).toEqual({})
        })
    })

    describe('writing a URL', () => {
        it('writes nothing for the default query', () => {
            const params = albumQueryToParams(emptyAlbumQuery())

            expect(Object.values(params).every(value => value == null)).toBe(true)
        })

        it('clears its own params rather than leaving a stale filter behind', () => {
            const cleared = albumQueryToParams({ ...emptyAlbumQuery(), filter: {} })

            expect(cleared).toHaveProperty('albumArtist', null)
            expect(cleared).toHaveProperty('recordLabel', null)
            expect(cleared).toHaveProperty('genre', null)
        })

        it('writes the direction whenever the sort column is not the default one', () => {
            const params = albumQueryToParams({
                ...emptyAlbumQuery(),
                sort: { field: AlbumSortField.year, direction: DEFAULT_ALBUM_SORT.direction },
            })

            expect(params).toMatchObject({ sort: 'year', dir: DEFAULT_ALBUM_SORT.direction })
        })

        it('writes the direction when the default column is sorted the other way', () => {
            const params = albumQueryToParams({
                ...emptyAlbumQuery(),
                sort: { field: DEFAULT_ALBUM_SORT.field, direction: OTHER_DIRECTION },
            })

            expect(params).toMatchObject({ sort: null, dir: OTHER_DIRECTION })
        })

        it('round-trips a fully populated query', () => {
            const query = {
                search: 'untrue',
                sort: { field: AlbumSortField.trackCount, direction: 'asc' as const },
                filter: {
                    albumArtistIds: ['a1', 'a2'],
                    recordLabelIds: ['l1'],
                    genreIds: ['g1'],
                },
            }

            const params = albumQueryToParams(query)
            const roundTripped = albumQueryFromParams(
                Object.fromEntries(
                    Object.entries(params).filter(([, value]) => value != null) as [string, string][],
                ),
            )

            expect(roundTripped).toEqual(query)
        })
    })

    describe('nextAlbumSort', () => {
        it('flips the direction when the same column is picked again', () => {
            expect(
                nextAlbumSort({ field: AlbumSortField.title, direction: 'asc' }, AlbumSortField.title),
            ).toEqual({ field: AlbumSortField.title, direction: 'desc' })
        })

        it.each([
            [AlbumSortField.title, 'asc'],
            [AlbumSortField.albumArtist, 'asc'],
            [AlbumSortField.recordLabel, 'asc'],
            [AlbumSortField.year, 'desc'],
            [AlbumSortField.trackCount, 'desc'],
            [AlbumSortField.dateAdded, 'desc'],
        ])('starts %s in its natural direction', (field, expected) => {
            expect(nextAlbumSort({ field: AlbumSortField.title, direction: 'desc' }, field).direction).toBe(
                expected,
            )
        })
    })

    describe('value equality', () => {
        it('treats a rebuilt but identical query as unchanged', () => {
            expect(
                sameAlbumQuery(
                    albumQueryFromParams({ sort: 'year' }),
                    albumQueryFromParams({ sort: 'year' }),
                ),
            ).toBe(true)
        })

        it('treats an omitted and an empty id list as the same filter', () => {
            expect(sameAlbumFilter({}, { albumArtistIds: [] })).toBe(true)
        })

        it('notices a different id', () => {
            expect(sameAlbumFilter({ albumArtistIds: ['a1'] }, { albumArtistIds: ['a2'] })).toBe(false)
        })

        it('notices a different search, sort and direction', () => {
            const base = emptyAlbumQuery()

            expect(sameAlbumQuery(base, { ...base, search: 'x' })).toBe(false)
            expect(
                sameAlbumQuery(base, { ...base, sort: { ...base.sort, field: AlbumSortField.year } }),
            ).toBe(false)
            expect(
                sameAlbumQuery(base, { ...base, sort: { ...base.sort, direction: OTHER_DIRECTION } }),
            ).toBe(false)
        })
    })
})
