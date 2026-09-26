import type { RecordLabelQuery } from '@release-maestro/core'
import { firstValue, type ReadonlyParams } from './query-params.utils'

export const recordLabelQueryFromParams = (params: ReadonlyParams): RecordLabelQuery => ({
    search: firstValue(params['q']) ?? '',
    sort: { field: 'name', direction: firstValue(params['dir']) == 'desc' ? 'desc' : 'asc' },
})
export const recordLabelQueryToParams = (query: RecordLabelQuery) => ({
    q: query.search || null,
    sort: null,
    dir: query.sort.direction == 'asc' ? null : query.sort.direction,
})
export const sameRecordLabelQuery = (left: RecordLabelQuery, right: RecordLabelQuery): boolean =>
    left.search == right.search && left.sort.direction == right.sort.direction
