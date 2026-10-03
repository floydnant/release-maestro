import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core'
import { HlmProgress } from '@spartan-ng/helm/progress'
import { semanticColor, SemanticColorIdentifier } from '../../design-tokens.generated'

export type ProgressBarSegment = {
    percent: number
    color: SemanticColorIdentifier
}

@Component({
    selector: 'app-progress-bar',
    templateUrl: './progress-bar.component.html',
    styleUrls: ['./progress-bar.component.css'],
    changeDetection: ChangeDetectionStrategy.OnPush,
    imports: [HlmProgress],
})
export class ProgressBarComponent {
    isShownAsPercentage = true
    toggleShownAsPercentage() {
        this.isShownAsPercentage = !this.isShownAsPercentage
    }

    segments = input.required<ProgressBarSegment[]>()
    totalPercent = computed(() => this.segments().reduce((acc, segment) => acc + segment.percent, 0))

    shouldGlow = input<boolean>(true)
    ariaLabel = input('Library scan progress', { alias: 'aria-label' })

    semanticColor = semanticColor
}
