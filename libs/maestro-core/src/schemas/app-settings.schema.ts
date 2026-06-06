import z from 'zod'
import { EmailVendor } from './email.schema'

export const appSettingsSchema = z.object({
    emailPluginConfig: z
        .object({
            APPLE_MAIL: z.object({
                // @TODO: this could also be an array if the user wants to export from multiple mailboxes
                mailboxName: z.string().optional(),
            }),
        } satisfies Record<EmailVendor, z.ZodObject>)
        .partial()
        .catch({}),
})
export type AppSettings = z.infer<typeof appSettingsSchema>
