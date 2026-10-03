import { Directive } from '@angular/core'
import { BrnFieldControlDescribedBy } from '@spartan-ng/brain/field'
import { BrnInput } from '@spartan-ng/brain/input'
import { classes, hlm } from '@spartan-ng/helm/utils'

@Directive({
    selector: '[hlmInput]',
    hostDirectives: [
        { directive: BrnInput, inputs: ['id', 'forceInvalid'] },
        { directive: BrnFieldControlDescribedBy, inputs: ['aria-describedby'] },
    ],
    host: { 'data-slot': 'input' },
})
export class HlmInput {
    constructor() {
        classes(() =>
            hlm(
                'h-(--foundation-size-control-md) rounded-lg border border-border-default bg-background-canvas px-3 py-1 type-body-md text-content-primary transition-colors duration-fast ease-standard focus-visible:border-border-focus focus-visible:ring-2 focus-visible:ring-border-focus data-[matches-spartan-invalid=true]:border-status-danger-border file:text-content-primary placeholder:text-content-muted w-full min-w-0 outline-none file:inline-flex file:border-0 file:bg-transparent disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50',
            ),
        )
    }
}
