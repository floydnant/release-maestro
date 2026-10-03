import { Observable } from 'rxjs'
import { EmailImportStreamPacket, EmailVendor } from '@release-maestro/core'
import { AppleMailRepository } from './apple-mail.repository'
import { SettingsBackendService } from '../settings.backend.service'

export interface EmailImporterPlugin {
    /**
     * Exports the emails in `mailboxName` received at or after `receivedSince`, or every email when it
     * is null. A null mailbox is one the user has not configured, which fails the stream.
     */
    loadEmails(
        signal: AbortSignal,
        mailboxName: string | null,
        receivedSince: Date | null,
    ): Observable<EmailImportStreamPacket>
}
export type EmailImporterPluginConstructor = new () => EmailImporterPlugin

export const emailImporterPlugins: Record<EmailVendor, EmailImporterPluginConstructor> = {
    APPLE_MAIL: AppleMailRepository,
}

export class EmailBackendRepository {
    constructor(private settingsService: SettingsBackendService) {}

    /** Takes the mailbox rather than reading it, so the caller's checkpoint is for the mailbox exported. */
    async loadEmails(
        vendor: EmailVendor,
        abortSignal: AbortSignal,
        mailboxName: string | null,
        receivedSince: Date | null,
    ): Promise<Observable<EmailImportStreamPacket>> {
        const PluginClass = emailImporterPlugins[vendor]
        const plugin = new PluginClass()

        return plugin.loadEmails(abortSignal, mailboxName, receivedSince)
    }

    getMailboxName(vendor: EmailVendor): string | null {
        return this.settingsService.getSettings().emailPluginConfig?.[vendor]?.mailboxName || null
    }
}
