import {
    ChangeDetectionStrategy,
    Component,
    computed,
    ElementRef,
    inject,
    linkedSignal,
    viewChild,
} from '@angular/core'
import { FormsModule } from '@angular/forms'
import { FeedService } from '../../../../core/services/feed.service'
import { createRendererLogger } from '../../../../core/logging/logger'
import { SettingsService } from '../../../../core/settings/settings.service'
import { ProgressRingComponent } from '../../../../shared/components/progress-ring/progress-ring.component'

const log = createRendererLogger('apple-mail-settings')

@Component({
    selector: 'app-apple-mail',
    imports: [FormsModule, ProgressRingComponent],
    templateUrl: './apple-mail.component.html',
    changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AppleMailImporterComponent {
    settingsService = inject(SettingsService)
    private readonly feedService = inject(FeedService)
    private readonly importStatus = viewChild.required<ElementRef<HTMLElement>>('importStatus')

    mailboxName = linkedSignal(() => {
        const settings = this.settingsService.settings.value()
        if (!settings) return undefined

        return settings.emailPluginConfig?.APPLE_MAIL?.mailboxName || null
    })

    hasChanges = computed(() => {
        const settings = this.settingsService.settings.value()
        if (!settings) return false

        return settings.emailPluginConfig?.APPLE_MAIL?.mailboxName != this.mailboxName()
    })

    /** The running or last import of this session, whichever started it. */
    readonly importUpdate = this.feedService.emailImportUpdate
    readonly isImporting = computed(() => {
        const phase = this.importUpdate()?.phase
        return phase === 'started' || phase === 'processing'
    })

    /** Why "Import now" is disabled, or null when it is not, or settings have not loaded yet. */
    readonly importBlockedReason = computed(() => {
        const settings = this.settingsService.settings.value()
        if (!settings) return null
        if (!settings.emailPluginConfig?.APPLE_MAIL?.mailboxName) return 'Save a mailbox name to import from.'
        if (this.hasChanges()) return 'Save the mailbox name to import from it.'
        return null
    })
    readonly canImport = computed(
        () => !!this.settingsService.settings.value() && !this.isImporting() && !this.importBlockedReason(),
    )

    async saveSettings() {
        const settings = this.settingsService.settings.value()
        if (!settings) return

        settings.emailPluginConfig.APPLE_MAIL = {
            ...settings.emailPluginConfig?.APPLE_MAIL,
            mailboxName: this.mailboxName() || undefined,
        }

        await this.settingsService.setSettings(settings)
    }

    importNow(): void {
        if (!this.canImport()) return
        this.feedService.triggerEmailImport('manual').catch(err => {
            log.error('feed.manual-import.trigger-failed', err)
        })
    }

    /**
     * The cancel button disappears once the import stops, and "Import now" is disabled until then, so
     * keep focus on the status that reports the cancel.
     */
    cancelImport(event: MouseEvent): void {
        if (event.currentTarget === document.activeElement) {
            this.importStatus().nativeElement.focus({ preventScroll: true })
        }
        this.feedService.cancelEmailImport()
    }
}
