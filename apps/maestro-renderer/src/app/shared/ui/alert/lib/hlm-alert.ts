import { Directive, input } from '@angular/core'
import { classes, hlm } from '@spartan-ng/helm/utils'
import { cva, type VariantProps } from 'class-variance-authority'

const alertVariants = cva('grid gap-2 rounded-lg border px-4 py-3 type-body-sm group/alert relative w-full', {
    variants: {
        variant: {
            default: 'border-border-default bg-background-surface text-content-primary',
            destructive: 'border-status-danger-border bg-status-danger-background text-status-danger-content',
        },
    },
    defaultVariants: {
        variant: 'default',
    },
})

export type AlertVariants = VariantProps<typeof alertVariants>

@Directive({
    selector: 'hlm-alert,[hlmAlert]',
    host: {
        'data-slot': 'alert',
        role: 'alert',
    },
})
export class HlmAlert {
    public readonly variant = input<AlertVariants['variant']>('default')

    constructor() {
        classes(() => hlm(alertVariants({ variant: this.variant() })))
    }
}
