import { IconComponent } from '../../../components/icon/icon.component'
import { ChangeDetectionStrategy, Component } from '@angular/core'
import { BrnSelectScrollUp } from '@spartan-ng/brain/select'
import { classes, hlm } from '@spartan-ng/helm/utils'

@Component({
    selector: 'hlm-select-scroll-up',
    imports: [IconComponent],
    changeDetection: ChangeDetectionStrategy.OnPush,
    hostDirectives: [BrnSelectScrollUp],
    template: ` <app-icon name="chevronUp" /> `,
})
export class HlmSelectScrollUp {
    constructor() {
        classes(() =>
            hlm(
                'flex items-center justify-center py-1 text-content-muted sticky top-0 w-full data-hidden:hidden',
            ),
        )
    }
}
