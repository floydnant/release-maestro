import { Directive, ElementRef, inject } from '@angular/core'
import { takeUntilDestroyed, toObservable } from '@angular/core/rxjs-interop'
import { distinctUntilChanged, filter } from 'rxjs'
import { LibraryService } from '../../core/services/library.service'

/** A repaired cache file keeps its URL. Retry failed images that are already on screen. */
@Directive({ selector: 'img[appRetryCoverAfterScan]' })
export class RetryCoverAfterScanDirective {
    constructor() {
        const image = inject<ElementRef<HTMLImageElement>>(ElementRef).nativeElement
        toObservable(inject(LibraryService).scanStatus)
            .pipe(
                filter(
                    status =>
                        status?.phase == 'completed' ||
                        status?.phase == 'failed' ||
                        status?.phase == 'cancelled',
                ),
                distinctUntilChanged((previous, current) => previous?.scanId == current?.scanId),
                takeUntilDestroyed(),
            )
            // This subscription performs a DOM effect; it does not copy stream values into state.
            .subscribe(() => {
                const source = image.getAttribute('src')
                if (source && image.complete && image.naturalWidth == 0) image.src = source
            })
    }
}
