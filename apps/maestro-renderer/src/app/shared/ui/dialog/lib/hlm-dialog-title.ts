import { Directive } from '@angular/core'
import { BrnDialogTitle } from '@spartan-ng/brain/dialog'
import { classes, hlm } from '@spartan-ng/helm/utils'

@Directive({
    selector: '[hlmDialogTitle]',
    hostDirectives: [BrnDialogTitle],
    host: { 'data-slot': 'dialog-title' },
})
export class HlmDialogTitle {
    constructor() {
        classes(() => hlm('type-section-title text-content-primary'))
    }
}
