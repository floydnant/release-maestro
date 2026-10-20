import { Directive } from '@angular/core'
import { BrnSelectSeparator } from '@spartan-ng/brain/select'
import { classes, hlm } from '@spartan-ng/helm/utils'

@Directive({
    selector: '[hlmSelectSeparator],hlm-select-separator',
    hostDirectives: [{ directive: BrnSelectSeparator, inputs: ['orientation'] }],
    host: { 'data-slot': 'select-separator' },
})
export class HlmSelectSeparator {
    constructor() {
        classes(() => hlm('-mx-1 my-1 h-px bg-border-subtle pointer-events-none'))
    }
}
