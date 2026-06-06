import { Observable } from 'rxjs'
import { EmailImportStreamPacket, EmailVendor } from '@release-maestro/core'
import { AppleMailRepository } from './apple-mail.repository'
import { SettingsBackendService } from '../settings.backend.service'

export interface EmailImporterPlugin {
    loadEmails(signal: AbortSignal): Observable<EmailImportStreamPacket>
}
export type EmailImporterPluginConstructor = new (settings: SettingsBackendService) => EmailImporterPlugin

export const emailImporterPlugins: Record<EmailVendor, EmailImporterPluginConstructor> = {
    APPLE_MAIL: AppleMailRepository,
}

export class EmailBackendRepository {
    constructor(private settingsService: SettingsBackendService) {}

    async loadEmails(
        vendor: EmailVendor,
        abortSignal: AbortSignal,
    ): Promise<Observable<EmailImportStreamPacket>> {
        const PluginClass = emailImporterPlugins[vendor]
        const plugin = new PluginClass(this.settingsService)

        return plugin.loadEmails(abortSignal)
    }
}
