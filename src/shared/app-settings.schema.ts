import z from 'zod'
import { EmailVendor } from '../../app/email/email.schema'

export const appSetingsSchema = z.object({
    emailPluginConfig: z
        .object({
            APPLE_MAIL: z.object({
                // @TODO: this could also be an array if the user wants to export from multiple mailboxes
                mailboxName: z.string().optional(),
            }),
        } satisfies Record<EmailVendor, z.ZodObject>)
        .partial(),
})
export type AppSettings = z.infer<typeof appSetingsSchema>
