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

const librarySettingsSchema = z.object({
    /** Root folders of the user's music library. Absent/empty until onboarding/setup. */
    folders: z.string().array().optional(),
    /** Set when the user explicitly skips library onboarding (keeps the nudge CTA instead). */
    onboardingSkipped: z.boolean().optional(),
})
export type LibrarySettings = z.infer<typeof librarySettingsSchema>

/**
 * Canonical settings shape. Writes (`set-settings` / `patch-settings`) are parsed
 * with this schema and *rejected* when invalid, so bad payloads can never corrupt
 * the store.
 */
export const appSettingsSchema = z.object({
    library: librarySettingsSchema.prefault({}),
    emailPluginConfig: emailPluginConfigSchema.catch({}),
})
export type AppSettings = z.infer<typeof appSettingsSchema>

/**
 * Tolerant variant for *reading* a possibly stale/hand-edited store: individually
 * invalid fields are dropped instead of failing the whole read, so an old or
 * corrupted config file can never brick startup. Same inferred type.
 *
 * Catches sit on the *leaves* as well as on `library` itself, so one corrupted
 * folder list cannot take its sibling settings down with it.
 */
export const storedAppSettingsSchema = z.object({
    library: z
        .object({
            folders: z.string().array().optional().catch(undefined),
            onboardingSkipped: z.boolean().optional().catch(undefined),
        })
        .prefault({})
        .catch({}),
    emailPluginConfig: emailPluginConfigSchema.catch({}),
})
