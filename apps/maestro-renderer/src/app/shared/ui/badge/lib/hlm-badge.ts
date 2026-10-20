import { Directive, input } from '@angular/core'
import { classes, hlm } from '@spartan-ng/helm/utils'
import { type VariantProps, cva } from 'class-variance-authority'

const badgeVariants = cva(
    'gap-1 rounded-full border px-3 py-1 type-label-sm no-underline transition-colors duration-fast ease-standard group/badge focus-visible:border-border-focus focus-visible:ring-border-focus aria-invalid:border-status-danger-border aria-invalid:ring-status-danger-border inline-flex w-fit shrink-0 items-center justify-center overflow-hidden whitespace-nowrap focus-visible:ring-2 [&>app-icon]:pointer-events-none',
    {
        variants: {
            variant: {
                default: 'border-action-primary bg-action-primary text-action-primary-content',
                secondary: 'border-border-subtle bg-background-surface text-content-secondary',
                destructive:
                    'border-status-danger-border bg-status-danger-background text-status-danger-content',
                outline: 'border-border-default text-content-secondary',
                ghost: 'border-transparent text-content-secondary hover:bg-action-quiet-hover',
                link: 'border-transparent text-content-action hover:underline',
            },
        },
        defaultVariants: {
            variant: 'default',
        },
    },
)

export type BadgeVariants = VariantProps<typeof badgeVariants>

@Directive({
    selector: '[hlmBadge],hlm-badge',
    host: {
        'data-slot': 'badge',
        '[attr.data-variant]': 'variant()',
    },
})
export class HlmBadge {
    public readonly variant = input<BadgeVariants['variant']>('default')

    constructor() {
        classes(() => hlm(badgeVariants({ variant: this.variant() })))
    }
}
