import { Directive } from '@angular/core'
import { BrnDialogDescription } from '@spartan-ng/brain/dialog'
import { classes, hlm } from '@spartan-ng/helm/utils'

@Directive({
    selector: '[hlmDialogDescription]',
    hostDirectives: [BrnDialogDescription],
    host: { 'data-slot': 'dialog-description' },
})
export class HlmDialogDescription {
    constructor() {
        classes(() => hlm('type-body-sm text-content-muted'))
    }
}
