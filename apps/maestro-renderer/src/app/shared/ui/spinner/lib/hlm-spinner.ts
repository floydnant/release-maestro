import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core'
import { classes, hlm } from '@spartan-ng/helm/utils'
import { semanticColor } from '../../../design-tokens.generated'

@Component({
    selector: 'hlm-spinner',
    changeDetection: ChangeDetectionStrategy.OnPush,
    host: {
        'data-slot': 'spinner',
        role: 'status',
        '[attr.aria-label]': 'ariaLabel()',
        '[style.width.px]': 'diameter()',
        '[style.height.px]': 'diameter()',
    },
    template: `
        <svg [attr.height]="diameter()" [attr.width]="diameter()" aria-hidden="true">
            <circle
                [attr.stroke-width]="strokeWidth()"
                [attr.stroke]="bgColor()"
                fill="transparent"
                [attr.r]="radius()"
                [attr.cx]="position()"
                [attr.cy]="position()"
            />
            <circle
                class="spinner-ring"
                [attr.stroke-width]="strokeWidth()"
                [attr.stroke]="color()"
                [attr.stroke-dasharray]="strokeDasharray()"
                [attr.stroke-dashoffset]="offset()"
                fill="transparent"
                [attr.r]="radius()"
                [attr.cx]="position()"
                [attr.cy]="position()"
            />
            <circle
                class="spinner-ring spinner-ring-2"
                [attr.stroke-width]="strokeWidth()"
                [attr.stroke]="color()"
                [attr.stroke-dasharray]="strokeDasharray()"
                [attr.stroke-dashoffset]="offset()"
                fill="transparent"
                [attr.r]="radius()"
                [attr.cx]="position()"
                [attr.cy]="position()"
            />
        </svg>
    `,
    styleUrl: './hlm-spinner.css',
})
export class HlmSpinner {
    /** Aria label for the spinner for accessibility. */
    public readonly ariaLabel = input<string>('Loading', { alias: 'aria-label' })
    public readonly diameter = input(22)
    public readonly strokeWidth = input(2.5)
    public readonly color = input<string | undefined>(semanticColor('content.action'))
    public readonly bgColor = input<string | undefined>(semanticColor('border.subtle'))

    protected readonly position = computed(() => this.diameter() / 2)
    protected readonly radius = computed(() => this.position() - this.strokeWidth() * 2)
    protected readonly circumference = computed(() => this.radius() * 2 * Math.PI)
    protected readonly offset = computed(() => this.circumference() * 0.8)
    protected readonly strokeDasharray = computed(() => `${this.circumference()} ${this.circumference()}`)

    constructor() {
        classes(() => hlm('inline-flex'))
    }
}
