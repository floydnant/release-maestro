import { ChangeDetectionStrategy, Component, computed, inject, linkedSignal } from '@angular/core'
import { FormsModule } from '@angular/forms'
import { SettingsService } from '../../../../core/settings/settings.service'

@Component({
    selector: 'app-apple-mail',
    imports: [FormsModule],
    templateUrl: './apple-mail.component.html',
    styles: ``,
    changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AppleMailImporterComponent {
    settingsService = inject(SettingsService)

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

    async saveSettings() {
        const settings = this.settingsService.settings.value()
        if (!settings) return

        settings.emailPluginConfig.APPLE_MAIL = {
            ...settings.emailPluginConfig?.APPLE_MAIL,
            mailboxName: this.mailboxName() || undefined,
        }

        await this.settingsService.setSettings(settings)
    }
}
