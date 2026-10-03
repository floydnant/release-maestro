import { Directive } from '@angular/core'
import { classes, hlm } from '@spartan-ng/helm/utils'

@Directive({
    selector: '[hlmFieldTitle],hlm-field-title',
    host: { 'data-slot': 'field-label' },
})
export class HlmFieldTitle {
    constructor() {
        classes(() => hlm('gap-2 type-label-sm text-content-secondary flex w-fit items-center'))
    }
}
