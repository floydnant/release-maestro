import * as fs from 'fs/promises'
import { Email, EmailImporterPlugin, emailSchema } from '../email.schema'
import { appEnv } from '../../app-env'

export class AppleMailRepository implements EmailImporterPlugin {
    async loadEmails(): Promise<Email[]> {
        // @TODO: this needs to be configurable via some plugin config mechanism
        return await fs.readFile(appEnv.EMAIL_JSON_PATH, 'utf-8').then(data => {
            return emailSchema.array().parse(JSON.parse(data))
        })
    }
}
