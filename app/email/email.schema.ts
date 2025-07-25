import { Observable } from 'rxjs'
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
    isRead: z.boolean({ coerce: true }),
    vendor: emailVendorSchema,
})
export type Email = z.infer<typeof emailSchema>

export type EmailImportStreamPacket = {
    current: number
    total: number
    email: Email
}

export interface EmailImporterPlugin {
    loadEmails(signal: AbortSignal): Observable<EmailImportStreamPacket>
}

export type EmailImportProgressUpdate =
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
          phase: 'error'
          errorMessage: string
      }
