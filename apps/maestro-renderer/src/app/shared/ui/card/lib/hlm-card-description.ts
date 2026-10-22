import { Directive } from '@angular/core'
import { classes, hlm } from '@spartan-ng/helm/utils'

@Directive({
    selector: '[hlmCardDescription]',
    host: { 'data-slot': 'card-description' },
})
export class HlmCardDescription {
    constructor() {
        classes(() => hlm('type-body-sm text-content-muted'))
    }
}
