import type { GenreQuery } from '@release-maestro/core'
import { firstValue, type ReadonlyParams } from './query-params.utils'

export const genreQueryFromParams = (params: ReadonlyParams): GenreQuery => ({
    search: firstValue(params['q']) ?? '',
    sort: { field: 'name', direction: firstValue(params['dir']) == 'desc' ? 'desc' : 'asc' },
})
export const genreQueryToParams = (query: GenreQuery) => ({
    q: query.search || null,
    sort: null,
    dir: query.sort.direction == 'asc' ? null : query.sort.direction,
})
export const sameGenreQuery = (left: GenreQuery, right: GenreQuery): boolean =>
    left.search == right.search && left.sort.direction == right.sort.direction
