import z from 'zod'

export const emailVendorSchema = z.enum(['APPLE_MAIL'])
export type EmailVendor = z.infer<typeof emailVendorSchema>

export const emailSchema = z.object({
    messageId: z.string(),
    subject: z.string(),
    dateReceived: z.string(),
    sender: z.string(),
    plainBody: z.string(),
    htmlBody: z.string(),
    isRead: z.coerce.boolean(),
    vendor: emailVendorSchema,
})
export type Email = z.infer<typeof emailSchema>

export type EmailImportStreamPacket = {
    current: number
    total: number
    /** Null when this message could not be exported or read after retrying. */
    email: Email | null
}

/**
 * What started an import. An `auto` import runs on app start or window focus when the last one is
 * stale; the title bar paces and summarizes it. A `manual` one is the user's, started from the Apple
 * Mail settings page; the title bar shows it live and the settings page reports its result.
 */
export const emailImportTriggerSchema = z.enum(['manual', 'auto'])
export type EmailImportTrigger = z.infer<typeof emailImportTriggerSchema>

/** One step of an import as the feed service produces it, before the trigger is known. */
export type EmailImportProgress =
    | {
          /** The export is running but has not produced an email yet. */
          phase: 'started'
      }
    | {
          phase: 'processing'
          current: number
          total: number
          message: string
      }
    | {
          phase: 'completed'
          totalProcessed: number
          totalImported: number
          newlyImported: number
          /** Messages left for the next import after retries were exhausted. */
          skippedEmails?: number
      }
    | {
          phase: 'cancelled'
      }
    | {
          phase: 'error'
          errorMessage: string
      }

/** A step of the running import, broadcast to every window. */
export type EmailImportProgressUpdate = EmailImportProgress & { trigger: EmailImportTrigger }
