import {
    ChangeDetectionStrategy,
    Component,
    computed,
    DestroyRef,
    effect,
    inject,
    input,
    output,
    signal,
} from '@angular/core'
import { EmailImportProgressUpdate } from '@release-maestro/core'
import { IconComponent } from './shared/components/icon/icon.component'
import { ProgressRingComponent } from './shared/components/progress-ring/progress-ring.component'
import { MinDwellPacer } from './shared/utils/min-dwell-pacer'

type EmailImportIndicatorView = Extract<
    EmailImportProgressUpdate,
    { phase: 'started' | 'processing' | 'completed' | 'error' }
>

/** Same pacing as the startup library scan, so a quick import does not flash in the title bar. */
const PHASE_MIN_DWELL_MS = 1000
const SUMMARY_VISIBLE_MS = 4000

/**
 * Title bar progress for an auto import, followed by a summary that hides after four seconds. Manual
 * imports report in the sidebar instead, so it ignores them.
 */
@Component({
    selector: 'app-email-import-indicator',
    templateUrl: './email-import-indicator.component.html',
    host: { class: 'contents' },
    changeDetection: ChangeDetectionStrategy.OnPush,
    imports: [IconComponent, ProgressRingComponent],
})
export class EmailImportIndicatorComponent {
    /** The latest import update. Each one is a new object, which is how a summary is told apart. */
    readonly update = input.required<EmailImportProgressUpdate | null>()
    /** Where the title bar shows nothing, such as onboarding. A summary that arrives here is dropped. */
    readonly hidden = input(false)
    readonly cancelImport = output<MouseEvent>()

    /** Paced view of {@link update}; written by {@link pacer}. */
    protected readonly view = signal<EmailImportIndicatorView | null>(null)
    /** The paced view can trail the import by a second; the cancel button must not. */
    protected readonly isRunning = computed(() => {
        const update = this.update()
        return update?.trigger === 'auto' && (update.phase === 'started' || update.phase === 'processing')
    })
    protected readonly percent = computed(() => {
        const view = this.view()
        if (view?.phase !== 'processing' || view.total === 0) return 0
        return (view.current / view.total) * 100
    })

    protected readonly summary = computed(() => {
        const view = this.view()
        if (view?.phase === 'error') {
            return {
                icon: 'error',
                color: 'content.danger',
                text: 'Email import failed',
                title: view.errorMessage,
            } as const
        }
        if (view?.phase !== 'completed') return null

        const count = view.newlyImported
        return {
            icon: 'success',
            color: count > 0 ? 'content.success' : 'content.secondary',
            text: count > 0 ? `Added ${count} ${count === 1 ? 'release' : 'releases'}` : 'No new releases',
            title: '',
        } as const
    })

    protected readonly summaryClass = computed(() => {
        const color = this.summary()?.color
        if (color === 'content.danger') return 'text-content-danger'
        return color === 'content.success' ? 'text-content-success' : 'text-content-secondary'
    })

    private readonly dismissedSummary = signal<EmailImportProgressUpdate | null>(null)
    /** A summary that arrived while hidden; it would be stale by the time the indicator shows. */
    private skippedSummary: EmailImportProgressUpdate | null = null
    private visibleSummary: EmailImportIndicatorView | null = null
    private summaryTimer: ReturnType<typeof setTimeout> | null = null
    private readonly pacer = new MinDwellPacer<EmailImportIndicatorView>(view => this.show(view))

    constructor() {
        effect(() => {
            const update = this.update()
            const isSummary = update?.phase === 'completed' || update?.phase === 'error'
            if (this.hidden() && isSummary) this.skippedSummary = update
            if (
                !update ||
                this.hidden() ||
                update.trigger !== 'auto' ||
                update.phase === 'cancelled' ||
                update === this.skippedSummary ||
                update === this.dismissedSummary()
            ) {
                this.pacer.set(null)
            } else if (isSummary) {
                this.pacer.set({ key: 'summary', value: update, minDwellMs: 0 })
            } else {
                this.pacer.set({ key: update.phase, value: update, minDwellMs: PHASE_MIN_DWELL_MS })
            }
        })
        inject(DestroyRef).onDestroy(() => {
            this.pacer.dispose()
            if (this.summaryTimer !== null) clearTimeout(this.summaryTimer)
        })
    }

    private show(view: EmailImportIndicatorView | null): void {
        this.view.set(view)
        const summary = view?.phase === 'completed' || view?.phase === 'error' ? view : null
        if (summary === this.visibleSummary) return

        if (this.summaryTimer !== null) clearTimeout(this.summaryTimer)
        this.summaryTimer = null
        this.visibleSummary = summary
        if (summary !== null) {
            this.summaryTimer = setTimeout(() => {
                this.summaryTimer = null
                this.dismissedSummary.set(summary)
            }, SUMMARY_VISIBLE_MS)
        }
    }
}
