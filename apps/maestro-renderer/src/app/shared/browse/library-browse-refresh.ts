import { inject } from '@angular/core'
import { toObservable } from '@angular/core/rxjs-interop'
import { auditTime, distinctUntilChanged, filter, merge } from 'rxjs'
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
            filter(
                status =>
                    status?.phase == 'completed' || status?.phase == 'cancelled' || status?.phase == 'failed',
            ),
            // A short scan can broadcast only its terminal snapshot. Two scans ending
            // in the same phase still need separate refreshes, even without a progress tick.
            distinctUntilChanged((previous, current) => previous?.scanId == current?.scanId),
        ),
    )
}
