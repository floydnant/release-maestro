import { Component, input, Input, ViewEncapsulation } from '@angular/core'
import { colorFrom, ColorIdentifier } from '../../colors'

@Component({
    selector: 'app-progress-ring',
    imports: [],
    templateUrl: './progress-ring.component.html',
    styleUrls: ['./progress-ring.component.css'],
    host: {
        class: 'inline-block',
    },
    encapsulation: ViewEncapsulation.None,
})
export class ProgressRingComponent {
    @Input() diameter = 22
    @Input() strokeWidth = 2.5

    @Input() progress = 0
    @Input() mode: 'progress' | 'spinning' = 'progress'

    color = input<string | undefined, ColorIdentifier | undefined>(colorFrom('tinted-100'), {
        transform: v => v && colorFrom(v),
    })
    bgColor = input<string | undefined, ColorIdentifier | undefined>(colorFrom('tinted-500'), {
        transform: v => v && colorFrom(v),
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
