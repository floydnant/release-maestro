import { Directive, input } from '@angular/core'
import { classes, hlm } from '@spartan-ng/helm/utils'

@Directive({
    selector: 'legend[hlmFieldLegend]',
    host: {
        'data-slot': 'field-legend',
        '[attr.data-variant]': 'variant()',
    },
})
export class HlmFieldLegend {
    public readonly variant = input<'label' | 'legend'>('legend')

    constructor() {
        classes(() => hlm('mb-3 type-label-md text-content-primary'))
    }
}
