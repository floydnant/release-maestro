import { IconComponent } from '../../../components/icon/icon.component'
import { ChangeDetectionStrategy, Component, inject } from '@angular/core'
import { BrnSelectItem } from '@spartan-ng/brain/select'
import { classes, hlm } from '@spartan-ng/helm/utils'

@Component({
    selector: 'hlm-select-item',
    imports: [IconComponent],
    changeDetection: ChangeDetectionStrategy.OnPush,
    hostDirectives: [{ directive: BrnSelectItem, inputs: ['id', 'disabled', 'value'] }],
    host: { 'data-slot': 'select-item' },
    template: `
        <ng-content />
        @if (_active()) {
            <app-icon name="check" class="absolute inset-e-2 size-4" aria-hidden="true" />
        }
    `,
})
export class HlmSelectItem {
    private readonly _brnSelectItem = inject(BrnSelectItem)

    protected readonly _active = this._brnSelectItem.active

    constructor() {
        classes(() =>
            hlm(
                'gap-2 rounded-md py-1.5 ps-2 pe-8 type-body-sm data-highlighted:bg-action-quiet-hover relative flex w-full cursor-default items-center outline-hidden select-none data-disabled:pointer-events-none data-disabled:opacity-50 [&_app-icon]:pointer-events-none [&_app-icon]:shrink-0',
            ),
        )
    }
}
