import { Directive } from '@angular/core'
import { HlmLabel } from '@spartan-ng/helm/label'
import { classes, hlm } from '@spartan-ng/helm/utils'

@Directive({
    selector: '[hlmFieldLabel],hlm-field-label',
    hostDirectives: [HlmLabel],
    host: { 'data-slot': 'field-label' },
})
export class HlmFieldLabel {
    constructor() {
        classes(() =>
            hlm([
                'type-label-sm text-content-secondary group/field-label peer/field-label flex w-fit',
                'has-[>[data-slot=field]]:w-full has-[>[data-slot=field]]:flex-col',
            ]),
        )
    }
}
