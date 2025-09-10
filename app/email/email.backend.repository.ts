import { Observable } from 'rxjs'
import { diContainer } from '../di'
import { EmailImportStreamPacket, EmailVendor } from '../../shared/schemas/email.schema'
import { AppleMailRepository } from './importers/apple-mail.repository'
import { SettingsBackendService } from '../settings.backend.service'

export interface EmailImporterPlugin {
    loadEmails(signal: AbortSignal): Observable<EmailImportStreamPacket>
}
export type EmailImporterPluginConstructor = new (settings: SettingsBackendService) => EmailImporterPlugin

export const emailImporterPlugins: Record<EmailVendor, EmailImporterPluginConstructor> = {
    APPLE_MAIL: AppleMailRepository,
}

export class EmailBackendRepository {
    async loadEmails(
        vendor: EmailVendor,
        abortSignal: AbortSignal,
    ): Promise<Observable<EmailImportStreamPacket>> {
        const plugin = await diContainer.get(emailImporterPlugins[vendor])

        return plugin.loadEmails(abortSignal)
    }
}
