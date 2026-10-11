import { Directive } from '@angular/core'
import { classes } from '@spartan-ng/helm/utils'

@Directive({
    selector: 'ul[hlmSidebarMenuSub]',
    host: {
        'data-slot': 'sidebar-menu-sub',
        'data-sidebar': 'menu-sub',
    },
})
export class HlmSidebarMenuSub {
    constructor() {
        classes(() => 'ms-3 mt-1 flex min-w-0 flex-col gap-1 border-s border-border-subtle ps-2')
    }
}
