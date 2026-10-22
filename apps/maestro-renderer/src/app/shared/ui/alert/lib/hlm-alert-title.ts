import { Directive } from '@angular/core'
import { classes, hlm } from '@spartan-ng/helm/utils'

@Directive({
    selector: '[hlmAlertTitle]',
    host: {
        'data-slot': 'alert-title',
    },
})
export class HlmAlertTitle {
    constructor() {
        classes(() =>
            hlm('type-label-md [&_a]:hover:text-content-primary [&_a]:underline [&_a]:underline-offset-3'),
        )
    }
}
