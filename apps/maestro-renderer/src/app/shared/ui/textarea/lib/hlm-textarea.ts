import { Directive } from '@angular/core'
import { BrnFieldControlDescribedBy } from '@spartan-ng/brain/field'
import { BrnTextarea } from '@spartan-ng/brain/textarea'
import { classes, hlm } from '@spartan-ng/helm/utils'

@Directive({
    selector: '[hlmTextarea]',
    hostDirectives: [
        { directive: BrnTextarea, inputs: ['id', 'forceInvalid'] },
        { directive: BrnFieldControlDescribedBy, inputs: ['aria-describedby'] },
    ],
    host: { 'data-slot': 'textarea' },
})
export class HlmTextarea {
    constructor() {
        classes(() =>
            hlm(
                'rounded-lg border border-border-default bg-background-canvas px-3 py-1 type-body-md text-content-primary transition-colors duration-fast ease-standard focus-visible:ring-2 focus-visible:ring-border-focus data-[matches-spartan-invalid=true]:border-status-danger-border placeholder:text-content-muted w-full outline-none disabled:cursor-not-allowed',
            ),
        )
    }
}
