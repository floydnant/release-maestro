import { Directive } from '@angular/core'
import { classes, hlm } from '@spartan-ng/helm/utils'

@Directive({
    selector: '[hlmFieldContent],hlm-field-content',
    host: { 'data-slot': 'field-content' },
})
export class HlmFieldContent {
    constructor() {
        classes(() => hlm('gap-1.5 group/field-content flex flex-1 flex-col leading-snug'))
    }
}
