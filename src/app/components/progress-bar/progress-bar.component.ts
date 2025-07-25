import { CommonModule } from '@angular/common'
import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core'

export type ProgressBarSegment = {
    percent: number
    colorValue: string
}

@Component({
    selector: 'app-progress-bar',
    templateUrl: './progress-bar.component.html',
    styleUrls: ['./progress-bar.component.css'],
    changeDetection: ChangeDetectionStrategy.OnPush,
    imports: [CommonModule],
})
export class ProgressBarComponent {
    isShownAsPercentage = true
    toggleShownAsPercentage() {
        this.isShownAsPercentage = !this.isShownAsPercentage
    }

    segments = input.required<ProgressBarSegment[]>()
    totalPercent = computed(() => this.segments().reduce((acc, segment) => acc + segment.percent, 0))

    shouldGlow = input<boolean>(true)
}
