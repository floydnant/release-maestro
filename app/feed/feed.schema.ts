import type { Artist, Label, Track } from 'bandcamp-fetch'
import z from 'zod'
import {
    bandcampEmailFansBoughtMusicFeedSourceItemSchema,
    bandcampEmailNewReleaseFeedSourceItemSchema,
} from './feed-source.schema'

const feedItemBaseSchema = z.object({
    id: z.string(),
    /**
     * Datetime the item was ingested into the feed database.
     */
    ingestedAt: z.date(),
    /**
     * Indicates the time of event the source of the feed item was originally generated at.
     * E.g.
     * - for emails: the datetime the email was received at
     * - for links: the datetime the link was pasted into the stash
     * - for rss feeds: the datetime the item was published at
     */
    eventDate: z.date(),
    isSnoozed: z.boolean(),
    lastViewedAt: z.date().nullable(),
    dedupeIdentifier: z.string(),
})

export const bandcampTralbumFeedItem = feedItemBaseSchema.extend({
    type: z.literal('BANDCAMP.TRALBUM'),
    data: z.object({
        tralbumUrl: z.string(),
        tralbumType: z.enum(['album', 'track']),
    }),
    source: z.discriminatedUnion('type', [
        bandcampEmailNewReleaseFeedSourceItemSchema,
        bandcampEmailFansBoughtMusicFeedSourceItemSchema,
    ]),
})
export type BandcampFeedItem = z.infer<typeof bandcampTralbumFeedItem>

export const feedItemMasterSchema = z.discriminatedUnion('type', [bandcampTralbumFeedItem])
export type FeedItemMaster = z.infer<typeof feedItemMasterSchema>

////////////////////////////////////////////////////////////////////////////////
/////////////////////////////////// HYDRATED ///////////////////////////////////
////////////////////////////////////////////////////////////////////////////////

export type HydratedBandcampReleaseFeedItem = {
    data: {
        releaseUrl: string
        releaseDate: Date | null
        emailReceivedAt: Date
        isEmailRead: boolean
        emailId: string
        releaseName: string
        label: Label | Artist | null
        artist: Omit<Artist, 'type'> | undefined
        releaseType: 'album' | 'track'
        about: string
        links: { title: string; favicon: string | undefined; url: string }[]
        unsubscribeUrl: string | null
        unsubscribeText: string
        imageUrl: string | undefined
        iframeUrl: string | null
        tracks: Omit<Track, 'type'>[]
    }
    id: string
    type: 'BANDCAMP.TRALBUM'
}

export type HydratedFeedItem = HydratedBandcampReleaseFeedItem
