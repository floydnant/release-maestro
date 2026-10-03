import { Directive } from '@angular/core'
import { classes, hlm } from '@spartan-ng/helm/utils'

@Directive({
    selector: '[hlmDialogFooter],hlm-dialog-footer',
    host: { 'data-slot': 'dialog-footer' },
})
export class HlmDialogFooter {
    constructor() {
        classes(() =>
            hlm(
                'mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end flex flex-col-reverse gap-2 sm:flex-row sm:justify-end',
            ),
        )
    }
}
