import { diContainer } from '../di'
import { AppleMailRepository } from './importers/apple-mail.repository'
import { Email, EmailImporterPlugin } from './email.schema'

export const emailImporterPlugins = {
    appleMail: AppleMailRepository,
} satisfies Record<string, new () => EmailImporterPlugin>

export class EmailBackendRepository {
    async loadEmails(viaPlugin: keyof typeof emailImporterPlugins): Promise<Email[]> {
        const plugin = await diContainer.get(emailImporterPlugins[viaPlugin])
        const emails = await plugin.loadEmails()

        return emails
    }
}
