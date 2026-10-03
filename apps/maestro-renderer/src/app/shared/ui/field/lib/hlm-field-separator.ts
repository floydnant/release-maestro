import { ChangeDetectionStrategy, Component } from '@angular/core'
import { HlmSeparator } from '@spartan-ng/helm/separator'
import { classes, hlm } from '@spartan-ng/helm/utils'

@Component({
    selector: 'hlm-field-separator',
    imports: [HlmSeparator],
    changeDetection: ChangeDetectionStrategy.OnPush,
    host: { 'data-slot': 'field-separator' },
    template: `
        <hlm-separator class="absolute inset-0 top-1/2" />
        <span
            data-slot="field-separator-content"
            class="relative mx-auto block w-fit bg-background-surface px-3"
        >
            <ng-content />
        </span>
    `,
})
export class HlmFieldSeparator {
    constructor() {
        classes(() => hlm('my-4 h-5 type-body-sm text-content-muted relative'))
    }
}
