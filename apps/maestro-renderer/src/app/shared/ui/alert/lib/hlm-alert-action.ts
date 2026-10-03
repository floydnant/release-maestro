import { Directive } from '@angular/core'
import { classes, hlm } from '@spartan-ng/helm/utils'

@Directive({
    selector: '[hlmAlertAction]',
    host: {
        'data-slot': 'alert-action',
    },
})
export class HlmAlertAction {
    constructor() {
        classes(() => hlm('col-start-2 row-span-2 row-start-1 self-start justify-self-end'))
    }
}
