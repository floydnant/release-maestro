import { IconComponent, type IconIdentitfier } from '../../../components/icon/icon.component'
import { ChangeDetectionStrategy, Component, input } from '@angular/core'
import { classes, hlm } from '@spartan-ng/helm/utils'

@Component({
    selector: 'hlm-spinner',
    imports: [IconComponent],
    changeDetection: ChangeDetectionStrategy.OnPush,
    host: {
        'data-slot': 'spinner',
        role: 'status',
        '[attr.aria-label]': 'ariaLabel()',
    },
    template: ` <app-icon [name]="icon()" /> `,
})
export class HlmSpinner {
    /**
     * The name of the icon to be used as the spinner.
     * Use to register custom icons.
     */
    public readonly icon = input<IconIdentitfier>('loading')

    /** Aria label for the spinner for accessibility. */
    public readonly ariaLabel = input<string>('Loading', { alias: 'aria-label' })

    constructor() {
        classes(() => hlm('inline-flex size-4 motion-safe:animate-spin'))
    }
}
