import { appEnv } from '../app-env'
import { BandcampEmail, parseBandcampEmail } from './bandcamp.email-parser'
import { EmailBackendRepository } from '../email/email.backend.repository'

export class BandcampEmailBackendService {
    constructor(private emailRepo: EmailBackendRepository) {}

    async listBandcampEmails(): Promise<BandcampEmail[]> {
        const emails = await this.emailRepo.loadEmails(appEnv.EMAIL_JSON_PATH)
        return emails.map(parseBandcampEmail)
    }
}
