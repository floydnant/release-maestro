import { CommonModule } from '@angular/common'
import { Component, Input, ViewEncapsulation } from '@angular/core'
import colors from '../../../../colors.json'

@Component({
    selector: 'app-progress-ring',
    imports: [CommonModule],
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

    @Input() color = colors.tinted[100]
    @Input() bgColor = colors.tinted[500]

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
