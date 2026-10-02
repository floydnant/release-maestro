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
    email: Email
}

/**
 * What started an import. An `auto` import runs on app start or window focus when the last one is
 * stale, and reports in the title bar. A `manual` one is the user's, and reports in the sidebar.
 */
export type EmailImportTrigger = 'manual' | 'auto'

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
