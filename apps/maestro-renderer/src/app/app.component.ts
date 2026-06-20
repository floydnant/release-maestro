import { Component, computed, inject, linkedSignal, ChangeDetectionStrategy } from '@angular/core'
import { toSignal } from '@angular/core/rxjs-interop'
import { RouterModule } from '@angular/router'
import { TranslateModule, TranslateService } from '@ngx-translate/core'
import { Observable } from 'rxjs'
import { EmailImportProgressUpdate } from '@release-maestro/core'
import { webEnv } from '../environments/environment'
import { ElectronService } from './core/services'
import { WebAudioPlayer } from './core/services/audio-player.service'
import { FeedService } from './core/services/feed.service'
import {
    ProgressBarComponent,
    ProgressBarSegment,
} from './shared/components/progress-bar/progress-bar.component'
import { IconComponent } from './shared/components/icon/icon.component'

@Component({
    selector: 'app-root',
    templateUrl: './app.component.html',
    styleUrls: ['./app.component.css'],
    standalone: true,
    changeDetection: ChangeDetectionStrategy.OnPush,
    imports: [RouterModule, TranslateModule, ProgressBarComponent, IconComponent],
})
export class AppComponent {
    translate = inject(TranslateService)
    electronService = inject(ElectronService)
    feedService = inject(FeedService)
    audioPlayer = inject(WebAudioPlayer)

    readonly showDesignSystem = !webEnv.production
    readonly isElectron = this.electronService.isElectron
    readonly showCustomWindowControls = this.isElectron && this.electronService.platform !== 'darwin'

    constructor() {
        this.translate.setDefaultLang('en')
        console.log('webEnv', webEnv)

        if (this.electronService.isElectron) {
            console.log('Run in electron')
            console.log('Electron ipcRenderer', this.electronService.ipcRenderer)
            console.log('NodeJS childProcess', this.electronService.childProcess)
        } else {
            console.log('Run in browser')
        }
    }

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
}
