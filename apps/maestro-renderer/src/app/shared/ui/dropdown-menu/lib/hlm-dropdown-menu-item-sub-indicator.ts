import { IconComponent } from '../../../components/icon/icon.component'
import { ChangeDetectionStrategy, Component } from '@angular/core'
import { classes, hlm } from '@spartan-ng/helm/utils'

@Component({
    selector: 'hlm-dropdown-menu-item-sub-indicator',
    imports: [IconComponent],
    changeDetection: ChangeDetectionStrategy.OnPush,
    template: ` <app-icon name="navigationForward" class="size-4 rtl:rotate-180" /> `,
})
export class HlmDropdownMenuItemSubIndicator {
    constructor() {
        classes(() => hlm('ms-auto flex items-center justify-center'))
    }
}
