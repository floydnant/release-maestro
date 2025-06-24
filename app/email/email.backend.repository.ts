import * as fs from 'fs/promises'
import z from 'zod'

const emailSchema = z.object({
    messageId: z.string(),
    subject: z.string(),
    dateReceived: z.string(),
    sender: z.string(),
    plainBody: z.string(),
    htmlBody: z.string(),
    isRead: z.boolean({ coerce: true }),
})
export type Email = z.infer<typeof emailSchema>

export class EmailBackendRepository {
    async loadEmails(path: string): Promise<Email[]> {
        return await fs.readFile(path, 'utf-8').then(data => {
            return emailSchema.array().parse(JSON.parse(data))
        })
    }
}
