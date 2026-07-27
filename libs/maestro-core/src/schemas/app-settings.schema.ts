import z from 'zod'
import { EmailVendor } from './email.schema'

const emailPluginConfigSchema = z
    .object({
        APPLE_MAIL: z.object({
            // @TODO: this could also be an array if the user wants to export from multiple mailboxes
            mailboxName: z.string().optional(),
        }),
    } satisfies Record<EmailVendor, z.ZodObject>)
    .partial()

/**
 * Canonical settings shape. Writes (`set-settings` / `patch-settings`) are parsed
 * with this schema and *rejected* when invalid, so bad payloads can never corrupt
 * the store.
 */
export const appSettingsSchema = z.object({
    /** Root folders of the user's music library. Absent/empty until onboarding/setup. */
    libraryFolders: z.string().array().optional(),
    /** Set when the user explicitly skips library onboarding (keeps the nudge CTA instead). */
    libraryOnboardingSkipped: z.boolean().optional(),
    emailPluginConfig: emailPluginConfigSchema.catch({}),
})
export type AppSettings = z.infer<typeof appSettingsSchema>

/**
 * Tolerant variant for *reading* a possibly stale/hand-edited store: individually
 * invalid fields are dropped instead of failing the whole read, so an old or
 * corrupted config file can never brick startup. Same inferred type.
 */
export const storedAppSettingsSchema = z.object({
    libraryFolders: z.string().array().optional().catch(undefined),
    libraryOnboardingSkipped: z.boolean().optional().catch(undefined),
    emailPluginConfig: emailPluginConfigSchema.catch({}),
})
