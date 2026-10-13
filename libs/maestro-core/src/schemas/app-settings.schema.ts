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
 * Hours a snoozed release stays out of the feed after its last view.
 *
 * The default is deliberately shorter than a day: snoozing reads as "show again tomorrow", and a full
 * 24h would push the item past the same time next day, so a user with a routine would keep missing it.
 */
export const DEFAULT_FEED_SNOOZE_HOURS = 16
export const MIN_FEED_SNOOZE_HOURS = 1
/** One week. */
export const MAX_FEED_SNOOZE_HOURS = 168
const feedSnoozeHoursSchema = z.number().int().min(MIN_FEED_SNOOZE_HOURS).max(MAX_FEED_SNOOZE_HOURS)

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
    /** Missing feed preferences use their defaults, including in older stores. */
    feed: z
        .object({
            hideUnplayableReleases: z.boolean().optional(),
            snoozeHours: feedSnoozeHoursSchema.optional(),
        })
        .optional(),
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
    feed: z
        .object({
            hideUnplayableReleases: z.boolean().optional().catch(undefined),
            snoozeHours: feedSnoozeHoursSchema.optional().catch(undefined),
        })
        .optional()
        .catch(undefined),
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
