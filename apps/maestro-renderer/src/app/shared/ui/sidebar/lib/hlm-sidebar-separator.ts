import { Directive } from '@angular/core'
import { HlmSeparator } from '@spartan-ng/helm/separator'
import { classes } from '@spartan-ng/helm/utils'

@Directive({
    selector: '[hlmSidebarSeparator],hlm-sidebar-separator',
    hostDirectives: [HlmSeparator],
    host: {
        'data-slot': 'sidebar-separator',
        'data-sidebar': 'separator',
    },
})
export class HlmSidebarSeparator {
    constructor() {
        // The base separator is full width when horizontal; auto width lets the margins set the inset.
        classes(() => 'mx-2 bg-border-subtle data-horizontal:w-auto')
    }
}
