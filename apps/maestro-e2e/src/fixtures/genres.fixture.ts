import type { GenreDetail, GenreRow, QueryGenresRequest, GenreWindowResult } from '@release-maestro/core'
import { DEFAULT_LIBRARY, type TaggedTrackSpec } from './tagged-library.fixture'

export const createGenre = (overrides: Partial<GenreDetail> = {}): GenreDetail => ({
    id: 'ambient',
    name: 'Ambient',
    songCount: 2,
    artistCount: 1,
    albumCount: 1,
    recordLabelCount: 1,
    ...overrides,
})
export const GENRE_ROWS: GenreRow[] = [
    createGenre(),
    createGenre({ id: 'techno', name: 'Techno', artistCount: 2 }),
]

export const genreCatalog = ({ query, window }: QueryGenresRequest): GenreWindowResult => {
    const total = 10_000
    const rows = Array.from({ length: Math.min(window.limit, total - window.offset) }, (_, index) => {
        const position =
            query.sort.direction == 'asc' ? window.offset + index : total - window.offset - index - 1
        return createGenre({ id: `genre-${position}`, name: `Genre ${position}` })
    })
    return { rows, offset: window.offset, total }
}

/** The shared scan fixture plus an unsplit compound genre and an untagged song. */
export const GENRE_LIBRARY: TaggedTrackSpec[] = [
    ...DEFAULT_LIBRARY,
    {
        fileName: '07-compound.mp3',
        title: 'Compound',
        artist: 'Guest',
        album: 'Collection',
        genre: 'Techno; Ambient',
    },
    { fileName: '08-untagged.mp3', title: 'Untagged', artist: 'Guest', album: 'Collection' },
]
