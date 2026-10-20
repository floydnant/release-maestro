import { Directive, computed, input } from '@angular/core'
import { injectBrnProgress } from '@spartan-ng/brain/progress'
import { classes, hlm } from '@spartan-ng/helm/utils'
import { semanticColor } from '../../../design-tokens.generated'

export type ProgressSegmentColor = 'content.success' | 'content.warning' | 'content.danger'

@Directive({
    selector: '[hlmProgressSegment],hlm-progress-segment',
    host: {
        'data-slot': 'progress-segment',
        '[style.width.%]': '_width()',
        '[style.background]': '_color()',
        '[style.--color]': '_color()',
    },
})
export class HlmProgressSegment {
    readonly value = input.required<number>()
    readonly color = input<ProgressSegmentColor>('content.success')

    private readonly progress = injectBrnProgress()
    protected readonly _width = computed(() => {
        const max = this.progress.max()
        return max > 0 ? (Math.max(0, Math.min(this.value(), max)) / max) * 100 : 0
    })
    protected readonly _color = computed(() => semanticColor(this.color()))

    constructor() {
        classes(() => hlm('h-full shrink-0 first:rounded-s-full last:rounded-e-full'))
    }
}
