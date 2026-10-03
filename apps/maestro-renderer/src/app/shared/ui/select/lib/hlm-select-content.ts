import { BooleanInput } from '@angular/cdk/coercion'
import { booleanAttribute, ChangeDetectionStrategy, Component, input } from '@angular/core'
import { BrnSelectContent, BrnSelectList } from '@spartan-ng/brain/select'
import { classes, hlm } from '@spartan-ng/helm/utils'
import { HlmSelectScrollDown } from './hlm-select-scroll-down'
import { HlmSelectScrollUp } from './hlm-select-scroll-up'

@Component({
    selector: 'hlm-select-content',
    imports: [HlmSelectScrollUp, HlmSelectScrollDown, BrnSelectList],
    changeDetection: ChangeDetectionStrategy.OnPush,
    hostDirectives: [BrnSelectContent],
    template: `
        @if (showScroll()) {
            <hlm-select-scroll-up />
        }

        <div brnSelectList class="flex flex-col">
            <ng-content />
        </div>

        @if (showScroll()) {
            <hlm-select-scroll-down />
        }
    `,
})
export class HlmSelectContent {
    public readonly showScroll = input<boolean, BooleanInput>(false, { transform: booleanAttribute })

    constructor() {
        classes(() =>
            hlm(
                'max-h-64 rounded-lg border border-border-default bg-background-elevated p-1 text-content-primary shadow-lg type-body-sm relative flex w-(--brn-select-width) overflow-x-hidden overflow-y-auto',
            ),
        )
    }
}
