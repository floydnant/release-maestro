import { Observable } from 'rxjs'
import { diContainer } from '../di'
import { EmailImporterPluginConstructor, EmailImportStreamPacket, EmailVendor } from './email.schema'
import { AppleMailRepository } from './importers/apple-mail.repository'

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
