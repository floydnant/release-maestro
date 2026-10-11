import { type BooleanInput } from '@angular/cdk/coercion'
import { booleanAttribute, Directive, input } from '@angular/core'
import { classes } from '@spartan-ng/helm/utils'
import { cva } from 'class-variance-authority'

// The current page is marked by RouterLinkActive's aria-current, or by isActive for non-link
// buttons; both take the navigation button's selected treatment.
const sidebarMenuButtonVariants = cva(
    'peer/menu-button group/menu-button flex w-full items-center gap-2 overflow-hidden rounded-lg px-3 text-start text-content-secondary no-underline transition-colors duration-fast ease-standard outline-none hover:bg-action-quiet-hover hover:text-content-primary focus-visible:ring-2 focus-visible:ring-border-focus active:bg-action-quiet-pressed disabled:pointer-events-none disabled:opacity-50 aria-disabled:pointer-events-none aria-disabled:opacity-50 aria-[current=page]:bg-action-secondary aria-[current=page]:text-action-primary-content aria-[current=page]:shadow-sm aria-[current=page]:hover:bg-action-secondary-hover data-active:bg-action-secondary data-active:text-action-primary-content data-active:shadow-sm group-has-data-[sidebar=menu-action]/menu-item:pe-8 [&_app-icon]:shrink-0 [&>span:last-child]:truncate',
    {
        variants: {
            variant: {
                default: '',
                outline: 'border border-border-default bg-background-canvas',
            },
            size: {
                default: 'h-(--foundation-size-control-sm) type-label-md',
                sm: 'h-6 type-label-sm',
                lg: 'h-(--foundation-size-control-md) type-label-md',
            },
        },
        defaultVariants: {
            variant: 'default',
            size: 'default',
        },
    },
)

@Directive({
    selector: 'button[hlmSidebarMenuButton], a[hlmSidebarMenuButton]',
    host: {
        'data-slot': 'sidebar-menu-button',
        'data-sidebar': 'menu-button',
        '[attr.data-size]': 'size()',
        '[attr.data-active]': 'isActive()',
    },
})
export class HlmSidebarMenuButton {
    public readonly variant = input<'default' | 'outline'>('default')
    public readonly size = input<'default' | 'sm' | 'lg'>('default')
    public readonly isActive = input<boolean, BooleanInput>(false, { transform: booleanAttribute })

    constructor() {
        classes(() => sidebarMenuButtonVariants({ variant: this.variant(), size: this.size() }))
    }
}
