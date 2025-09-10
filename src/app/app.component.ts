import { Component, computed, inject, linkedSignal } from '@angular/core'
import { toSignal } from '@angular/core/rxjs-interop'
import { RouterModule } from '@angular/router'
import { TranslateModule, TranslateService } from '@ngx-translate/core'
import { Observable } from 'rxjs'
import { EmailImportProgressUpdate } from '../../shared/schemas/email.schema'
import { webEnv } from '../environments/environment'
import { ElectronService } from './core/services'
import { WebAudioPlayer } from './core/services/audio-player.service'
import { FeedService } from './core/services/feed.service'
import { IconComponent } from './shared/components/icon/icon.component'
import {
    ProgressBarComponent,
    ProgressBarSegment,
} from './shared/components/progress-bar/progress-bar.component'

@Component({
    selector: 'app-root',
    templateUrl: './app.component.html',
    styleUrls: ['./app.component.css'],
    standalone: true,
    imports: [RouterModule, TranslateModule, ProgressBarComponent, IconComponent],
})
export class AppComponent {
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

    translate = inject(TranslateService)
    electronService = inject(ElectronService)
    feedService = inject(FeedService)
    audioPlayer = inject(WebAudioPlayer)

    triggerEmailImport() {
        this.feedService.triggerEmailImport()
    }
    cancelEmailImport() {
        this.feedService.cancelEmailImport()
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
            return [{ percent: 100, color: 'danger-400' }]
        }
        if (progress.phase === 'completed') {
            return [{ percent: 100, color: 'submit-400' }]
        }

        const percent = (progress.current / progress.total) * 100
        return [{ percent, color: 'submit-400' }]
    })
}
