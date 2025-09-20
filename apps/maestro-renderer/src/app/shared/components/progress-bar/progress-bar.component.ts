import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core'
import { colorFrom, ColorIdentifier } from '../../colors'

export type ProgressBarSegment = {
    percent: number
    color: ColorIdentifier
}

@Component({
    selector: 'app-progress-bar',
    templateUrl: './progress-bar.component.html',
    styleUrls: ['./progress-bar.component.css'],
    changeDetection: ChangeDetectionStrategy.OnPush,
    imports: [],
})
export class ProgressBarComponent {
    isShownAsPercentage = true
    toggleShownAsPercentage() {
        this.isShownAsPercentage = !this.isShownAsPercentage
    }

    segments = input.required<ProgressBarSegment[]>()
    totalPercent = computed(() => this.segments().reduce((acc, segment) => acc + segment.percent, 0))

    shouldGlow = input<boolean>(true)

    colorFrom = colorFrom
}
