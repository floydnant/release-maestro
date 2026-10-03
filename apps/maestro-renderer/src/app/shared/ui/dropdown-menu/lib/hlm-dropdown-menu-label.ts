import { type BooleanInput } from '@angular/cdk/coercion'
import { booleanAttribute, Directive, input } from '@angular/core'
import { classes, hlm } from '@spartan-ng/helm/utils'

@Directive({
    selector: '[hlmDropdownMenuLabel],hlm-dropdown-menu-label',
    host: {
        'data-slot': 'dropdown-menu-label',
        '[attr.data-inset]': 'inset() ? "" : null',
    },
})
export class HlmDropdownMenuLabel {
    public readonly inset = input<boolean, BooleanInput>(false, {
        transform: booleanAttribute,
    })

    constructor() {
        classes(() => hlm('px-2 py-1.5 type-label-sm text-content-muted data-[inset=true]:ps-8 block'))
    }
}
