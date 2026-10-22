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
import { assertUnreachable, EmailImportProgressUpdate } from '@release-maestro/core'
import { HlmButtonImports } from '@spartan-ng/helm/button'
import { HlmTooltipImports } from '@spartan-ng/helm/tooltip'
import { isEmailImportRunning, RunningEmailImportUpdate } from './core/services/feed.service'
import { IconComponent } from './shared/components/icon/icon.component'
import { ProgressRingComponent } from './shared/components/progress-ring/progress-ring.component'
import { MinDwellPacer } from './shared/utils/min-dwell-pacer'

type EmailImportIndicatorView =
    RunningEmailImportUpdate | Extract<EmailImportProgressUpdate, { phase: 'completed' | 'error' }>

/** Same pacing as the startup library scan, so a quick auto import does not flash in the title bar. */
const PHASE_MIN_DWELL_MS = 1000
const SUMMARY_VISIBLE_MS = 4000

/**
 * Title bar progress for any import, as for library scans: an auto import is paced and then summarized
 * for four seconds, a manual one is shown live and summarized on the Apple Mail settings page instead.
 */
@Component({
    selector: 'app-email-import-indicator',
    templateUrl: './email-import-indicator.component.html',
    host: { class: 'contents' },
    changeDetection: ChangeDetectionStrategy.OnPush,
    imports: [IconComponent, ProgressRingComponent, HlmButtonImports, HlmTooltipImports],
})
export class EmailImportIndicatorComponent {
    /** The latest import update. Each one is a new object, which is how a summary is told apart. */
    readonly update = input.required<EmailImportProgressUpdate | null>()
    /** Where the title bar shows nothing, such as onboarding. A summary that arrives here is dropped. */
    readonly hidden = input(false)
    readonly cancelImport = output<MouseEvent>()

    /** Paced view of {@link update}; written by {@link pacer}. */
    protected readonly view = signal<EmailImportIndicatorView | null>(null)
    /** What the title bar shows while the paced view is a running import. */
    protected readonly activity = computed(() => {
        const view = this.view()
        if (!isEmailImportRunning(view)) return null
        switch (view.phase) {
            case 'started':
                return {
                    ring: 'spinning',
                    color: 'content.secondary',
                    percent: 0,
                    label: 'Checking mail…',
                    count: null,
                } as const
            case 'processing':
                return {
                    ring: 'progress',
                    color: 'content.success',
                    percent: view.total === 0 ? 0 : (view.current / view.total) * 100,
                    label: 'Importing emails',
                    count: `${view.current}/${view.total}`,
                } as const
            case 'finishing':
                // The full ring keeps its colour and starts spinning: the same import, still at work.
                // No count or estimate, since lookups can wait on Bandcamp for a long time.
                return {
                    ring: 'spinning',
                    color: 'content.success',
                    percent: 0,
                    label: 'Adding releases…',
                    count: null,
                } as const
            default:
                return assertUnreachable(view)
        }
    })
    /** The paced view can trail the import by a second; the cancel button must not. */
    protected readonly isRunning = computed(() => isEmailImportRunning(this.update()))

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
        const skippedEmails = view.skippedEmails ?? 0
        if (skippedEmails > 0) {
            const added = count > 0 ? `${count} new ${count === 1 ? 'release' : 'releases'}. ` : ''
            return {
                icon: 'success',
                color: 'content.secondary',
                text: `${added}${skippedEmails} ${skippedEmails === 1 ? 'email' : 'emails'} will be retried.`,
                title: '',
            } as const
        }

        return {
            icon: 'success',
            color: count > 0 ? 'content.success' : 'content.secondary',
            text: count > 0 ? `${count} new ${count === 1 ? 'release' : 'releases'}` : 'No new releases',
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
                update.phase === 'cancelled' ||
                (isSummary && update.trigger !== 'auto') ||
                update === this.skippedSummary ||
                update === this.dismissedSummary()
            ) {
                this.pacer.set(null)
            } else if (isSummary) {
                this.pacer.set({ key: 'summary', value: update, minDwellMs: 0 })
            } else {
                const minDwellMs = update.trigger === 'auto' ? PHASE_MIN_DWELL_MS : 0
                this.pacer.set({ key: update.phase, value: update, minDwellMs })
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
