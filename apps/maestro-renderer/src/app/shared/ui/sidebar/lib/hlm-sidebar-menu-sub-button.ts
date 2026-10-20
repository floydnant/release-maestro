import { type BooleanInput } from '@angular/cdk/coercion'
import { booleanAttribute, Directive, input } from '@angular/core'
import { classes } from '@spartan-ng/helm/utils'

@Directive({
    selector: 'a[hlmSidebarMenuSubButton], button[hlmSidebarMenuSubButton]',
    host: {
        'data-slot': 'sidebar-menu-sub-button',
        'data-sidebar': 'menu-sub-button',
        '[attr.data-active]': 'isActive()',
        '[attr.data-size]': 'size()',
    },
})
export class HlmSidebarMenuSubButton {
    public readonly size = input<'sm' | 'md'>('md')
    public readonly isActive = input<boolean, BooleanInput>(false, { transform: booleanAttribute })

    constructor() {
        classes(
            () =>
                'flex h-(--foundation-size-control-sm) min-w-0 items-center gap-2 overflow-hidden rounded-lg px-2 text-content-secondary no-underline transition-colors duration-fast ease-standard outline-none hover:bg-action-quiet-hover hover:text-content-primary focus-visible:ring-2 focus-visible:ring-border-focus active:bg-action-quiet-pressed disabled:pointer-events-none disabled:opacity-50 aria-disabled:pointer-events-none aria-disabled:opacity-50 aria-[current=page]:bg-action-secondary aria-[current=page]:text-action-primary-content aria-[current=page]:shadow-sm aria-[current=page]:hover:bg-action-secondary-hover data-active:bg-action-secondary data-active:text-action-primary-content data-active:shadow-sm data-[size=md]:type-label-md data-[size=sm]:type-label-sm [&>app-icon]:shrink-0 [&>span:last-child]:truncate',
        )
    }
}
