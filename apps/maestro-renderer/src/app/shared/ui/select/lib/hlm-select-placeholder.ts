import { Directive } from '@angular/core'
import { BrnSelectPlaceholder } from '@spartan-ng/brain/select'
import { classes, hlm } from '@spartan-ng/helm/utils'

@Directive({
    selector: '[hlmSelectPlaceholder],hlm-select-placeholder',
    hostDirectives: [BrnSelectPlaceholder],
    host: { 'data-slot': 'select-placeholder' },
})
export class HlmSelectPlaceholder {
    constructor() {
        classes(() =>
            hlm(
                'text-content-muted flex items-center data-hidden:hidden [&_app-icon]:pointer-events-none [&_app-icon]:shrink-0',
            ),
        )
    }
}
