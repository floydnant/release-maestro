import { Directive } from '@angular/core'
import { classes, hlm } from '@spartan-ng/helm/utils'

@Directive({
    selector: '[hlmFieldGroup],hlm-field-group',
    host: { 'data-slot': 'field-group' },
})
export class HlmFieldGroup {
    constructor() {
        classes(() => hlm('gap-6 group/field-group @container/field-group flex w-full flex-col'))
    }
}
