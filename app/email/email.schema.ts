import z from 'zod'

export const emailSchema = z.object({
    messageId: z.string(),
    subject: z.string(),
    dateReceived: z.string(),
    sender: z.string(),
    plainBody: z.string(),
    htmlBody: z.string(),
    isRead: z.boolean({ coerce: true }),
})
export type Email = z.infer<typeof emailSchema>

export interface EmailImporterPlugin {
    loadEmails(): Promise<Email[]>
}
