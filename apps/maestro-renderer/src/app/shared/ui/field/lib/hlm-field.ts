import { Directive, input } from '@angular/core'
import { BrnField } from '@spartan-ng/brain/field'
import { classes, hlm } from '@spartan-ng/helm/utils'
import { cva, VariantProps } from 'class-variance-authority'

const fieldVariants = cva('gap-2 group/field flex w-full', {
    variants: {
        orientation: {
            vertical: 'gap-2 flex-col *:w-full [&>.sr-only]:w-auto',
            horizontal: [
                'gap-3 flex-row items-center',
                '*:data-[slot=field-label]:flex-auto',
                'has-[>[data-slot=field-content]]:items-start has-[>[data-slot=field-content]]:[&>[role=checkbox],[role=radio]]:mt-px',
            ],
            responsive: [
                'gap-3 flex-col *:w-full @md/field-group:flex-row @md/field-group:items-center @md/field-group:*:w-auto [&>.sr-only]:w-auto',
                '@md/field-group:*:data-[slot=field-label]:flex-auto',
                '@md/field-group:has-[>[data-slot=field-content]]:items-start @md/field-group:has-[>[data-slot=field-content]]:[&>[role=checkbox],[role=radio]]:mt-px',
            ],
        },
    },
    defaultVariants: {
        orientation: 'vertical',
    },
})

export type FieldVariants = VariantProps<typeof fieldVariants>

@Directive({
    selector: '[hlmField],hlm-field',
    hostDirectives: [{ directive: BrnField, inputs: ['data-invalid', 'forceInvalid'] }],
    host: {
        role: 'group',
        'data-slot': 'field',
        '[attr.data-orientation]': 'orientation()',
    },
})
export class HlmField {
    public readonly orientation = input<FieldVariants['orientation']>('vertical')

    constructor() {
        classes(() => hlm(fieldVariants({ orientation: this.orientation() })))
    }
}
