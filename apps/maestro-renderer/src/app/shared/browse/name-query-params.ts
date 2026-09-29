import type { NameSortedQuery } from '@release-maestro/core'
import { firstValue, type ReadonlyParams } from './query-params.utils'

/** URL state shared by the name-sorted catalog lists: genres, artists and record labels. */
export const nameQueryFromParams = (params: ReadonlyParams): NameSortedQuery => ({
    search: firstValue(params['q']) ?? '',
    sort: { field: 'name', direction: firstValue(params['dir']) == 'desc' ? 'desc' : 'asc' },
})
export const nameQueryToParams = (query: NameSortedQuery) => ({
    q: query.search || null,
    sort: null,
    dir: query.sort.direction == 'asc' ? null : query.sort.direction,
})
export const sameNameQuery = (left: NameSortedQuery, right: NameSortedQuery): boolean =>
    left.search == right.search && left.sort.direction == right.sort.direction
