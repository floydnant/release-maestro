import { NgClass } from '@angular/common'
import {
    ChangeDetectionStrategy,
    Component,
    computed,
    DestroyRef,
    effect,
    inject,
    linkedSignal,
    signal,
} from '@angular/core'
import { toSignal } from '@angular/core/rxjs-interop'
import { NavigationEnd, Router, RouterModule } from '@angular/router'
import { TranslateModule, TranslateService } from '@ngx-translate/core'
import { EmailImportProgressUpdate } from '@release-maestro/core'
import { filter, map, Observable } from 'rxjs'
import { webEnv } from '../environments/environment'
import { ElectronService } from './core/services'
import { WebAudioPlayer } from './core/services/audio-player.service'
import { FeedService } from './core/services/feed.service'
import { LibraryService } from './core/services/library.service'
import { SettingsService } from './core/settings/settings.service'
import { IconComponent } from './shared/components/icon/icon.component'
import {
    ProgressBarComponent,
    ProgressBarSegment,
} from './shared/components/progress-bar/progress-bar.component'
import { ProgressRingComponent } from './shared/components/progress-ring/progress-ring.component'
import { MinDwellPacer } from './shared/utils/min-dwell-pacer'

/** Compact model the sidebar renders for a running background scan. */
interface ScanIndicatorView {
    phase: 'discovering' | 'reading'
    discovered: number
    readDone: number
    readTotal: number
    failedFiles: number
}

/**
 * Minimum time each phase of a *startup* scan stays visible in the sidebar. Startup
 * rescans of an up-to-date library finish almost instantly; without this the
 * indicator flashes on and off, or blinks between phases, faster than the eye can
 * follow. Other scans (manual rescans) are shown in real time.
 */
const STARTUP_PHASE_MIN_DWELL_MS = 1000

@Component({
    selector: 'app-root',
    templateUrl: './app.component.html',
    styleUrls: ['./app.component.css'],
    standalone: true,
    changeDetection: ChangeDetectionStrategy.OnPush,
    imports: [
        RouterModule,
        TranslateModule,
        ProgressBarComponent,
        ProgressRingComponent,
        IconComponent,
        NgClass,
    ],
})
export class AppComponent {
    translate = inject(TranslateService)
    electronService = inject(ElectronService)
    feedService = inject(FeedService)
    audioPlayer = inject(WebAudioPlayer)
    libraryService = inject(LibraryService)
    private settingsService = inject(SettingsService)
    private router = inject(Router)

    readonly showDesignSystem = !webEnv.production
    readonly isElectron = this.electronService.isElectron
    readonly isMacos = this.isElectron && this.electronService.platform === 'darwin'

    triggerEmailImport() {
        this.feedService.triggerEmailImport().catch(err => {
            console.error('Failed to trigger email import:', err)
        })
    }
    cancelEmailImport() {
        this.feedService.cancelEmailImport()
    }

    minimizeWindow() {
        this.electronService.minimizeWindow().catch(err => {
            console.error('Failed to minimize window:', err)
        })
    }

    toggleMaximizeWindow() {
        this.electronService.toggleMaximizeWindow().catch(err => {
            console.error('Failed to toggle window maximize state:', err)
        })
    }

    closeWindow() {
        this.electronService.closeWindow().catch(err => {
            console.error('Failed to close window:', err)
        })
    }

    importProgress_ = toSignal(
        this.feedService.emailImportProgress$ as Observable<EmailImportProgressUpdate | { phase: 'idle' }>,
        { initialValue: { phase: 'idle' as const } },
    )
    importProgress = linkedSignal(() => this.importProgress_())

    progressBarSegments = computed((): ProgressBarSegment[] => {
        const progress = this.importProgress()
        if (!progress || progress.phase === 'idle') return []

        if (progress.phase === 'error') {
            return [{ percent: 100, color: 'content.danger' }]
        }
        if (progress.phase === 'completed') {
            return [{ percent: 100, color: 'content.success' }]
        }

        const percent = (progress.current / progress.total) * 100
        return [{ percent, color: 'content.success' }]
    })

    // --- library scan indicator / setup nudge -------------------------------

    private currentUrl = toSignal(
        this.router.events.pipe(
            filter((event): event is NavigationEnd => event instanceof NavigationEnd),
            map(event => event.urlAfterRedirects),
        ),
        { initialValue: this.router.url },
    )

    /** The onboarding/import flow takes over the whole window: no sidebar, title bar floats on top. */
    isImportRoute = computed(() => this.currentUrl().startsWith('/import'))

    /**
     * Paced sidebar view of the running scan. Startup scans hold each phase for a
     * minimum time (and drop the progress bar); other scans pass through live.
     * Written by {@link scanIndicatorPacer}.
     */
    readonly scanIndicator = signal<ScanIndicatorView | null>(null)
    private readonly scanIndicatorPacer = new MinDwellPacer<ScanIndicatorView>(view =>
        this.scanIndicator.set(view),
    )

    /** Nudge users who skipped onboarding (or lost their folders) toward library setup. */
    showLibrarySetupCta = computed(() => {
        if (this.scanIndicator() !== null) return false
        const settings = this.settingsService.settings.value()
        if (!settings) return false
        const hasFolders = (settings.libraryFolders?.length ?? 0) > 0
        return !hasFolders && !this.isImportRoute()
    })

    libraryScanSegments = computed((): ProgressBarSegment[] => {
        const view = this.scanIndicator()
        if (!view || view.readTotal === 0) return [{ percent: 0, color: 'content.success' }]
        return [{ percent: (view.readDone / view.readTotal) * 100, color: 'content.success' }]
    })

    constructor() {
        this.translate.setDefaultLang('en')
        console.log('webEnv', webEnv)

        if (this.electronService.isElectron) {
            console.log('Run in electron')
            console.log('Electron ipcRenderer', this.electronService.ipcRenderer)
        } else {
            console.log('Run in browser')
        }

        // Feed the pacer the desired indicator whenever the scan status or route changes.
        effect(() => {
            this.scanIndicatorPacer.set(this.targetScanIndicator())
        })
        inject(DestroyRef).onDestroy(() => this.scanIndicatorPacer.dispose())
    }

    /** The indicator the sidebar *wants* to show right now (pre-pacing), or null to hide. */
    private targetScanIndicator() {
        const status = this.libraryService.scanStatus()
        if (!status || this.isImportRoute()) return null
        if (status.phase !== 'discovering' && status.phase !== 'reading') return null

        const isStartup = status.trigger === 'startup'
        const view: ScanIndicatorView = {
            phase: status.phase,
            discovered: status.discovered,
            readDone: status.readDone,
            readTotal: status.readTotal,
            failedFiles: status.failedFiles,
        }
        return {
            key: status.phase,
            value: view,
            minDwellMs: isStartup ? STARTUP_PHASE_MIN_DWELL_MS : 0,
        }
    }
}
