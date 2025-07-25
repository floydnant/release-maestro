import { diContainer } from '../di'
import { AppleMailRepository } from './importers/apple-mail.repository'
import { Email, EmailImporterPlugin, EmailImportStreamPacket, EmailVendor } from './email.schema'
import { Observable } from 'rxjs'

export const emailImporterPlugins: Record<EmailVendor, new () => EmailImporterPlugin> = {
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
