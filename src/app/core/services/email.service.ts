import { inject, Injectable } from '@angular/core'
import { Album, Label, Track } from 'bandcamp-fetch'
import z from 'zod'
import { ElectronService } from './electron/electron.service'

const bandcampEmailEntry = z.object({
    messageId: z.string(),
    subject: z.string(),
    dateReceived: z.string(),
    sender: z.string(),
    plainBody: z.string(),
    htmlBody: z.string(),
    isRead: z.boolean({ coerce: true }),
    bandcampEmailType: z.enum([
        'NEW_MESSAGE',
        'NEW_RELEASE',
        'SHIPMENT_NOTIFICATION',
        'FANS_BOUGHT_NEW_STUFF',
        'THANK_YOU',
        'LISTENING_PARTY',
        'OTHER',
    ]),
    musicLinks: z.string().array().optional(),
    links: z.string().array().optional(),
})

export type RawBandcampEmail = z.infer<typeof bandcampEmailEntry>

export const mapBandcampEmailAndDataToRelease = (
    email: RawBandcampEmail,
    releaseData: Album | Track | null,
    labelData: Label | null,
) => {
    const type =
        releaseData?.type ||
        (email.musicLinks?.[0]?.includes('bandcamp.com/track') ? ('track' as const) : ('album' as const))
    const releaseUrl = releaseData?.url || email.musicLinks?.[0]

    return {
        releaseUrl: releaseUrl,
        releaseDate: releaseData?.releaseDate ? new Date(releaseData?.releaseDate) : null,
        emailReceivedAt: new Date(email.dateReceived),
        isEmailRead: email.isRead,
        emailId: email.messageId,
        releaseName: releaseData?.name || email.subject,
        label: labelData,
        artist: releaseData?.artist,
        type: type,
        plainBody: email.plainBody
            .replace(/\s*\?\s*/g, '\n')
            .replace(/�/g, '')
            .replace(
                /((Unfollow|Unsubscribe) .+)(?=\n)/i,
                `<a href="${email.links?.find(link => link.includes('fan_unsubscribe'))}">$1</a>`,
            )
            .replace(/check it out here/i, match => `<a href="${releaseUrl}">${match}</a>`)
            .trim()
            .replace(/\n/g, '<br>'),
        links: email.links?.filter(
            link =>
                !link.includes('f4.bcbits.com') &&
                !link.includes('fan_unsubscribe') &&
                !link.includes('https://bandcamp.com/img/email/bc-logo-small-2.gif'),
        ),
        imageUrl: releaseData?.imageUrl || email.links?.find(link => link.includes('f4.bcbits.com')),
        iframeUrl: releaseData?.id
            ? `https://bandcamp.com/EmbeddedPlayer/${type}=${releaseData.id}/size=large/bgcol=999999/linkcol=0687f5`
            : null,
        tracks: releaseData?.type == 'album' ? releaseData?.tracks || [] : releaseData ? [releaseData] : [],
    }
}
export type BandcampRelease = ReturnType<typeof mapBandcampEmailAndDataToRelease>

@Injectable({ providedIn: 'root' })
export class EmailService {
    private electronService = inject(ElectronService)

    async loadEmails(): Promise<RawBandcampEmail[]> {
        return await this.electronService.fsPromises
            .readFile(this.electronService.env.EMAIL_JSON_PATH, 'utf-8')
            .then(data => {
                return bandcampEmailEntry.array().parse(JSON.parse(data))
                // .sort((a, b) => new Date(a.dateReceived).getTime() - new Date(b.dateReceived).getTime())
            })
    }
}
