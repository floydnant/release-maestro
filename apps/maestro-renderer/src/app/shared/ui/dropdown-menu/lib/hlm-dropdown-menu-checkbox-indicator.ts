import { IconComponent } from '../../../components/icon/icon.component'
import { ChangeDetectionStrategy, Component } from '@angular/core'
import { classes, hlm } from '@spartan-ng/helm/utils'

@Component({
    selector: 'hlm-dropdown-menu-checkbox-indicator',
    imports: [IconComponent],
    changeDetection: ChangeDetectionStrategy.OnPush,
    host: { 'data-slot': 'dropdown-menu-checkbox-item-indicator' },
    template: ` <app-icon name="check" /> `,
})
export class HlmDropdownMenuCheckboxIndicator {
    constructor() {
        classes(() =>
            hlm(
                'absolute inset-s-2 flex size-4 items-center justify-center pointer-events-none opacity-0 group-data-checked/dropdown-menu-checkbox:opacity-100',
            ),
        )
    }
}
