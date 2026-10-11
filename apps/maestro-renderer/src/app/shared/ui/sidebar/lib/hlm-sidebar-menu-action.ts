import { type BooleanInput } from '@angular/cdk/coercion'
import { booleanAttribute, Directive, input } from '@angular/core'
import { classes } from '@spartan-ng/helm/utils'

@Directive({
    selector: 'button[hlmSidebarMenuAction]',
    host: {
        'data-slot': 'sidebar-menu-action',
        'data-sidebar': 'menu-action',
    },
})
export class HlmSidebarMenuAction {
    public readonly showOnHover = input<boolean, BooleanInput>(false, { transform: booleanAttribute })

    constructor() {
        classes(() => [
            'absolute end-1 top-0.5 flex size-6 items-center justify-center rounded-md text-content-muted outline-none transition-colors duration-fast ease-standard peer-hover/menu-button:text-content-primary hover:bg-action-quiet-hover hover:text-content-primary focus-visible:ring-2 focus-visible:ring-border-focus [&>app-icon]:shrink-0',
            this.showOnHover() &&
                'opacity-0 group-focus-within/menu-item:opacity-100 group-hover/menu-item:opacity-100 aria-expanded:opacity-100',
        ])
    }
}
