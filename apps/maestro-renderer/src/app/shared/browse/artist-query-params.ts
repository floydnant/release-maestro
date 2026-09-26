import type { ArtistQuery } from '@release-maestro/core'
import { firstValue, type ReadonlyParams } from './query-params.utils'

export const artistQueryFromParams = (params: ReadonlyParams): ArtistQuery => ({
    search: firstValue(params['q']) ?? '',
    sort: { field: 'name', direction: firstValue(params['dir']) == 'desc' ? 'desc' : 'asc' },
})
export const artistQueryToParams = (query: ArtistQuery) => ({
    q: query.search || null,
    dir: query.sort.direction == 'asc' ? null : query.sort.direction,
})
export const sameArtistQuery = (left: ArtistQuery, right: ArtistQuery): boolean =>
    left.search == right.search && left.sort.direction == right.sort.direction
