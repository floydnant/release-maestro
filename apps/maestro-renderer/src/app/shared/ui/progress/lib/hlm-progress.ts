import { Directive, contentChildren, input } from '@angular/core'
import { BrnProgress } from '@spartan-ng/brain/progress'
import { classes, hlm } from '@spartan-ng/helm/utils'
import { HlmProgressSegment } from './hlm-progress-segment'

@Directive({
    selector: 'hlm-progress,[hlmProgress]',
    hostDirectives: [{ directive: BrnProgress, inputs: ['value', 'max', 'getValueLabel'] }],
    host: {
        'data-slot': 'progress',
        '[attr.data-glow]': 'glow()',
    },
})
export class HlmProgress {
    readonly glow = input<'always' | 'hover' | 'off'>('always')
    private readonly segments = contentChildren(HlmProgressSegment)

    constructor() {
        classes(() =>
            hlm(
                'h-1.5 rounded-full bg-border-subtle relative inline-flex w-full',
                this.segments().length ? 'overflow-visible' : 'overflow-hidden',
            ),
        )
    }
}
