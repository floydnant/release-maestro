import { Directive } from '@angular/core'
import { classes } from '@spartan-ng/helm/utils'

@Directive({
    selector: 'div[hlmSidebarGroupLabel], button[hlmSidebarGroupLabel]',
    host: {
        'data-slot': 'sidebar-group-label',
        'data-sidebar': 'group-label',
    },
})
export class HlmSidebarGroupLabel {
    constructor() {
        classes(
            () =>
                'flex h-(--foundation-size-control-sm) shrink-0 items-center rounded-md px-3 type-label-sm text-content-muted outline-none focus-visible:ring-2 focus-visible:ring-border-focus [&>app-icon]:shrink-0',
        )
    }
}
