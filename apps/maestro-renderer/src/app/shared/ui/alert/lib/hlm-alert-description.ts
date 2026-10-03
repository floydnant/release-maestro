import { Directive } from '@angular/core'
import { classes, hlm } from '@spartan-ng/helm/utils'

@Directive({
    selector: '[hlmAlertDescription]',
    host: {
        'data-slot': 'alert-description',
    },
})
export class HlmAlertDescription {
    constructor() {
        classes(() =>
            hlm('type-body-sm [&_a]:hover:text-content-primary [&_a]:underline [&_a]:underline-offset-3'),
        )
    }
}
