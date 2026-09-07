import { inject } from '@angular/core'
import { toObservable } from '@angular/core/rxjs-interop'
import { auditTime, distinctUntilChanged, filter, map, merge } from 'rxjs'
import { LibraryService } from '../../core/services/library.service'

/** Refresh visible catalog data during ingest and once more when the scan ends. */
export const libraryBrowseRefresh = () => {
    const status$ = toObservable(inject(LibraryService).scanStatus)
    return merge(
        status$.pipe(
            filter(status => status?.phase == 'discovering' || status?.phase == 'reading'),
            auditTime(1_500),
        ),
        status$.pipe(
            map(status => status?.phase),
            distinctUntilChanged(),
            filter(phase => phase == 'completed' || phase == 'cancelled' || phase == 'failed'),
        ),
    )
}
