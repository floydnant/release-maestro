import z from 'zod'
import { emailSchema } from '../../shared/schemas/email.schema'

export const bandcampEmailNewReleaseFeedSourceItemSchema = emailSchema.extend({
    type: z.literal('EMAIL.BANDCAMP_NEW_RELEASE'),
    releaseUrl: z.string(),
    releaseType: z.enum(['album', 'track']),
    links: z.string().array(),
})
export type BandcampEmailNewReleaseFeedSourceItem = z.infer<
    typeof bandcampEmailNewReleaseFeedSourceItemSchema
>

export const bandcampEmailFansBoughtMusicFeedSourceItemSchema = emailSchema
    .pick({ messageId: true, dateReceived: true, isRead: true })
    .extend({
        type: z.literal('EMAIL.BANDCAMP_FANS_BOUGHT_MUSIC'),
        // @TODO: maybe we also parse the fans the music was bought by
        tralbumUrls: z.string().array(),
    })
export type BandcampEmailFansBoughtMusicFeedSourceItem = z.infer<
    typeof bandcampEmailFansBoughtMusicFeedSourceItemSchema
>

export type BandcampEmailFeedSourceItem =
    | BandcampEmailNewReleaseFeedSourceItem
    | BandcampEmailFansBoughtMusicFeedSourceItem

// @TODO:
export const linkStashBandcampTralbumFeedSourceItem = z.never()
export type LinkStashBandcampTralbumFeedSourceItem = z.infer<typeof linkStashBandcampTralbumFeedSourceItem>

export type FeedSourceItem = BandcampEmailFeedSourceItem | LinkStashBandcampTralbumFeedSourceItem
export type FeedSourceItemType = FeedSourceItem['type']
