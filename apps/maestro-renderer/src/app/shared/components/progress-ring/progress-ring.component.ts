import { Component, input, Input, ViewEncapsulation, ChangeDetectionStrategy } from '@angular/core'
import { semanticColor, SemanticColorIdentifier } from '../../design-tokens.generated'

@Component({
    selector: 'app-progress-ring',
    imports: [],
    templateUrl: './progress-ring.component.html',
    styleUrls: ['./progress-ring.component.css'],
    host: {
        class: 'inline-block',
    },
    changeDetection: ChangeDetectionStrategy.OnPush,
    encapsulation: ViewEncapsulation.None,
})
export class ProgressRingComponent {
    @Input() diameter = 22
    @Input() strokeWidth = 2.5

    @Input() progress = 0
    @Input() mode: 'progress' | 'spinning' = 'progress'

    color = input<string | undefined, SemanticColorIdentifier | undefined>(semanticColor('content.action'), {
        transform: value => value && semanticColor(value),
    })
    bgColor = input<string | undefined, SemanticColorIdentifier | undefined>(semanticColor('border.subtle'), {
        transform: value => value && semanticColor(value),
    })

    get position() {
        return this.diameter / 2
    }
    get radius() {
        return this.diameter / 2 - this.strokeWidth * 2
    }
    get circumference() {
        return this.radius * 2 * Math.PI
    }
    get offset() {
        const progress = this.mode == 'progress' ? this.progress : 20
        return this.circumference - (progress / 100) * this.circumference
    }
    get strokeDasharray() {
        return `${this.circumference} ${this.circumference}`
    }
}
