import { IconComponent } from '../../../components/icon/icon.component'
import { ChangeDetectionStrategy, Component } from '@angular/core'
import { BrnSelectScrollDown } from '@spartan-ng/brain/select'
import { classes, hlm } from '@spartan-ng/helm/utils'

@Component({
    selector: 'hlm-select-scroll-down',
    imports: [IconComponent],
    changeDetection: ChangeDetectionStrategy.OnPush,
    hostDirectives: [BrnSelectScrollDown],
    template: ` <app-icon name="chevronDown" /> `,
})
export class HlmSelectScrollDown {
    constructor() {
        classes(() =>
            hlm(
                'flex items-center justify-center py-1 text-content-muted sticky bottom-0 w-full data-hidden:hidden',
            ),
        )
    }
}
