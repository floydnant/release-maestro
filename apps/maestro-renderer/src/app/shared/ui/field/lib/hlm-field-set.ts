import { Directive } from '@angular/core'
import { classes, hlm } from '@spartan-ng/helm/utils'

@Directive({
    selector: 'fieldset[hlmFieldSet]',
    host: { 'data-slot': 'field-set' },
})
export class HlmFieldSet {
    constructor() {
        classes(() => hlm('gap-4 flex flex-col'))
    }
}
