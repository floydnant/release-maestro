import { BandcampEmailFeedSourceItem, BandcampFeedItem, BandcampPurchase } from '@release-maestro/core'

/** Emails saved together while the export is still running. */
export const EMAIL_IMPORT_SAVE_BATCH_SIZE = 50

/** Exported emails saved in one database write, and the feed items they produced. */
export type EmailSaveBatch = {
    /** Exported emails in the batch, including skipped and unrelated ones that produce no items. */
    emailCount: number
    feedItems: BandcampFeedItem[]
}

const isTrackUrl = (url: string) => url.includes('/track/')

const createBandcampFeedItem = (
    email: BandcampEmailFeedSourceItem,
    releaseUrl: string,
    purchases: BandcampPurchase[],
): BandcampFeedItem => ({
    id: crypto.randomUUID(),
    type: 'BANDCAMP.TRALBUM',
    dedupeIdentifier: releaseUrl,
    ingestedAt: new Date(),
    eventDate: new Date(email.dateReceived),
    isSnoozed: false,
    lastViewedAt: null,
    data: {
        tralbumUrl: releaseUrl,
        tralbumType: releaseUrl.includes('/album/') ? 'album' : 'track',
        purchases,
    },
    source:
        email.type === 'EMAIL.BANDCAMP_NEW_RELEASE'
            ? email
            : {
                  type: email.type,
                  messageId: email.messageId,
                  dateReceived: email.dateReceived,
                  isRead: email.isRead,
              },
})

/**
 * The feed items one email adds, or null while one of its tracks still waits for its parent album.
 *
 * An announcement adds its release. A purchase notification adds one item per release: bought
 * tracks join their parent album's item, and each purchase keeps its own URL, so a track's buyers
 * are attributed to that track while an album's buyers are attributed to all of its tracks.
 */
const feedItemsForEmail = (
    email: BandcampEmailFeedSourceItem,
    releaseUrlOf: (url: string) => string | undefined,
): BandcampFeedItem[] | null => {
    if (email.type === 'EMAIL.BANDCAMP_NEW_RELEASE') {
        const releaseUrl = releaseUrlOf(email.releaseUrl)
        return releaseUrl === undefined ? null : [createBandcampFeedItem(email, releaseUrl, [])]
    }

    // The parser lists each bought URL once, so grouping needs no further purchase merging.
    const purchasesByRelease = new Map<string, BandcampPurchase[]>()
    for (const purchase of email.purchases) {
        const releaseUrl = releaseUrlOf(purchase.tralbumUrl)
        if (releaseUrl === undefined) return null
        purchasesByRelease.set(releaseUrl, [...(purchasesByRelease.get(releaseUrl) ?? []), purchase])
    }
    return [...purchasesByRelease].map(([releaseUrl, purchases]) =>
        createBandcampFeedItem(email, releaseUrl, purchases),
    )
}

/**
 * Exported emails waiting to be saved, in export order.
 *
 * A track's feed item belongs to its parent album, so an email that mentions a track waits until
 * that album is known. Every other email is ready at once. Emails leave only from the front, so
 * saves keep export order however the lookups finish. Skipped and unrelated emails (`null`) hold
 * their place too, which keeps the saved count in step with the export.
 */
export class EmailImportQueue {
    /** Not yet ready, in export order: the first waits for a parent album, the rest wait behind it. */
    private readonly waiting: (BandcampEmailFeedSourceItem | null)[] = []
    /** Ready to save, in export order: each email's feed items. */
    private readonly ready: BandcampFeedItem[][] = []
    /** The release each bought or announced track belongs to; null while its lookup runs. */
    private readonly trackReleases = new Map<string, string | null>()

    /** Emails not yet handed out for saving. */
    get size(): number {
        return this.waiting.length + this.ready.length
    }

    /** Queues an email and returns the tracks whose parent album nobody has asked for yet. */
    enqueue(email: BandcampEmailFeedSourceItem | null): string[] {
        this.waiting.push(email)
        const urls =
            email === null
                ? []
                : email.type === 'EMAIL.BANDCAMP_NEW_RELEASE'
                  ? [email.releaseUrl]
                  : email.purchases.map(purchase => purchase.tralbumUrl)
        const lookups: string[] = []
        for (const url of urls) {
            if (!isTrackUrl(url) || this.trackReleases.has(url)) continue
            this.trackReleases.set(url, null)
            lookups.push(url)
        }
        return lookups
    }

    /** Records the release a track's feed item belongs to: its parent album, or the track itself. */
    resolveTrack(trackUrl: string, releaseUrl: string): void {
        this.trackReleases.set(trackUrl, releaseUrl)
    }

    /**
     * Hands out the ready front of the queue as save batches. While the export runs, only whole
     * batches leave, which keeps database writes few. Once it has ended, every ready email leaves,
     * so progress follows the remaining lookups one email at a time.
     */
    takeReady(exportEnded: boolean): EmailSaveBatch[] {
        this.moveReadyEmails()
        const count = exportEnded
            ? this.ready.length
            : this.ready.length - (this.ready.length % EMAIL_IMPORT_SAVE_BATCH_SIZE)
        const emails = this.ready.splice(0, count)
        const batches: EmailSaveBatch[] = []
        for (let start = 0; start < emails.length; start += EMAIL_IMPORT_SAVE_BATCH_SIZE) {
            const batch = emails.slice(start, start + EMAIL_IMPORT_SAVE_BATCH_SIZE)
            batches.push({ emailCount: batch.length, feedItems: batch.flat() })
        }
        return batches
    }

    /** Builds each email's feed items once, when it and every email before it are ready. */
    private moveReadyEmails(): void {
        const releaseUrlOf = (url: string) =>
            isTrackUrl(url) ? (this.trackReleases.get(url) ?? undefined) : url
        let moved = 0
        for (const email of this.waiting) {
            const feedItems = email === null ? [] : feedItemsForEmail(email, releaseUrlOf)
            if (feedItems === null) break
            this.ready.push(feedItems)
            moved++
        }
        this.waiting.splice(0, moved)
    }
}
