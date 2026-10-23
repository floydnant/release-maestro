import { DatePipe, NgTemplateOutlet } from '@angular/common'
import { ChangeDetectionStrategy, Component, input, output } from '@angular/core'
import { HydratedFeedItem } from '@release-maestro/core'
import { HlmButtonImports } from '@spartan-ng/helm/button'
import { IconComponent } from '../../shared/components/icon/icon.component'
import { ProgressRingComponent } from '../../shared/components/progress-ring/progress-ring.component'

/**
 * How a release that failed to load gets back: it is loading now, it waits for a scheduled automatic
 * reload, it reloads once scrolled into view, or the user retries it.
 */
export type ReleaseRecovery = 'reloading' | 'scheduled' | 'when-in-view' | 'manual'

/**
 * Why a release could not load and how it gets back. A rate limit (an error with `retryAt`) is
 * temporary, so it reads as a calm note; any other error is shown as a failure with Retry.
 */
@Component({
    selector: 'app-release-load-status',
    imports: [DatePipe, NgTemplateOutlet, HlmButtonImports, IconComponent, ProgressRingComponent],
    changeDetection: ChangeDetectionStrategy.OnPush,
    host: { class: 'block' },
    template: `
        <ng-template #progress>
            <app-progress-ring
                mode="spinning"
                [diameter]="16"
                [strokeWidth]="2"
                color="content.secondary"
                bgColor="transparent"
            ></app-progress-ring>
        </ng-template>
        <ng-template #retryButton>
            <button
                hlmBtn
                variant="ghost"
                size="xs"
                type="button"
                class="release-retry |"
                [attr.aria-label]="'Retry loading ' + releaseName()"
                (click)="retry.emit()"
            >
                Retry
            </button>
        </ng-template>

        @if (error().retryAt != null) {
            <div
                class="rate-limit | mb-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 type-body-sm text-content-muted"
                [attr.aria-busy]="recovery() === 'reloading'"
            >
                @switch (recovery()) {
                    @case ('reloading') {
                        <ng-container [ngTemplateOutlet]="progress"></ng-container>
                        <p>Loading this release again</p>
                    }
                    @case ('scheduled') {
                        <p>
                            Bandcamp asked us to slow down. This release loads again at
                            {{ error().retryAt | date: 'shortTime' }}.
                        </p>
                    }
                    @case ('when-in-view') {
                        <p>
                            Bandcamp asked us to slow down. This release loads again when it comes into view.
                        </p>
                    }
                    @case ('manual') {
                        <p>Bandcamp asked us to slow down.</p>
                        <ng-container [ngTemplateOutlet]="retryButton"></ng-container>
                    }
                }
            </div>
        } @else {
            <div
                class="error | mb-1.5 flex flex-wrap items-center gap-x-2 gap-y-1"
                [attr.aria-busy]="recovery() === 'reloading'"
            >
                <p class="text-content-danger">
                    <app-icon
                        name="error"
                        color="content.danger"
                        size="1.3rem"
                        class="translate-y-[3px]"
                    ></app-icon>
                </p>
                <p class="type-label-md text-content-danger">
                    {{ error().message || 'Error loading feed item' }}
                </p>
                @if (recovery() === 'reloading') {
                    <p class="flex items-center gap-1.5 type-body-sm text-content-muted">
                        <ng-container [ngTemplateOutlet]="progress"></ng-container>
                        Retrying
                    </p>
                } @else {
                    <ng-container [ngTemplateOutlet]="retryButton"></ng-container>
                }
            </div>
        }
    `,
})
export class ReleaseLoadStatusComponent {
    readonly error = input.required<NonNullable<HydratedFeedItem['error']>>()
    readonly recovery = input.required<ReleaseRecovery>()
    /** Names the release in the Retry button's accessible name. */
    readonly releaseName = input.required<string>()
    readonly retry = output()
}
