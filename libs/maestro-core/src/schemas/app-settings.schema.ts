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
    /** The folders that make up the user's music library. Absent/empty until onboarding/setup. */
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
 * Catches sit on the *leaves* as well as on the groups, so one corrupted value
 * cannot take its siblings down with it. This matters beyond the read itself:
 * whatever a read drops is what the next `patchSettings` writes back, so a
 * whole-group catch would quietly destroy the rest of that group's settings.
 */
export const storedAppSettingsSchema = z.object({
    library: z
        .object({
            folders: z.string().array().optional().catch(undefined),
            onboardingSkipped: z.boolean().optional().catch(undefined),
        })
        .prefault({})
        .catch({}),
    emailPluginConfig: z
        .object({
            APPLE_MAIL: z.object({ mailboxName: z.string().optional().catch(undefined) }).catch({}),
        } satisfies Record<EmailVendor, z.ZodType>)
        .partial()
        .catch({}),
})
