import { Directive } from '@angular/core'
import { classes, hlm } from '@spartan-ng/helm/utils'

@Directive({
    selector: '[hlmCardTitle]',
    host: { 'data-slot': 'card-title' },
})
export class HlmCardTitle {
    constructor() {
        classes(() => hlm('type-section-title text-content-primary'))
    }
}
