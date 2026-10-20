import { Directive } from '@angular/core'
import { classes, hlm } from '@spartan-ng/helm/utils'

@Directive({
    selector: '[hlmDropdownMenuShortcut],hlm-dropdown-menu-shortcut',
    host: { 'data-slot': 'dropdown-menu-shortcut' },
})
export class HlmDropdownMenuShortcut {
    constructor() {
        classes(() => hlm('ms-auto type-label-sm text-content-muted'))
    }
}
