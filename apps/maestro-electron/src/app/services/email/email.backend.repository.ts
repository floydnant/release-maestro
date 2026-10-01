import { Observable } from 'rxjs'
import { EmailImportStreamPacket, EmailVendor } from '@release-maestro/core'
import { AppleMailRepository } from './apple-mail.repository'
import { SettingsBackendService } from '../settings.backend.service'

export interface EmailImporterPlugin {
    /** Exports the emails received at or after `receivedSince`, or every email when it is null. */
    loadEmails(signal: AbortSignal, receivedSince: Date | null): Observable<EmailImportStreamPacket>
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
        receivedSince: Date | null,
    ): Promise<Observable<EmailImportStreamPacket>> {
        const PluginClass = emailImporterPlugins[vendor]
        const plugin = new PluginClass(this.settingsService)

        return plugin.loadEmails(abortSignal, receivedSince)
    }

    getMailboxName(vendor: EmailVendor): string | null {
        return this.settingsService.getSettings().emailPluginConfig?.[vendor]?.mailboxName || null
    }
}
