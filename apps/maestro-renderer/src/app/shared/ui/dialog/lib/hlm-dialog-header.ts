import { Directive } from '@angular/core'
import { classes, hlm } from '@spartan-ng/helm/utils'

@Directive({
    selector: '[hlmDialogHeader],hlm-dialog-header',
    host: { 'data-slot': 'dialog-header' },
})
export class HlmDialogHeader {
    constructor() {
        classes(() => hlm('flex flex-col gap-2 pe-8 flex flex-col'))
    }
}
