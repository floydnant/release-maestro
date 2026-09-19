import z from 'zod'
import { CalendarDay, calendarDaySchema } from './calendar-day.schema'

/** Preserve the date written by Bandcamp, before its offset can shift the day. */
const parseBandcampReleaseDate = (value: string): CalendarDay | null => {
    const isoDay = value.match(/^(\d{4}-\d{2}-\d{2})(?:T|$)/)?.[1]
    const bandcampDay = value.match(/^(?:[A-Za-z]{3},\s*)?(\d{1,2}) ([A-Za-z]{3}) (\d{4})(?: |$)/)
    const [, sourceDay = '', sourceMonth = '', sourceYear = ''] = bandcampDay ?? []
    const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
    const day =
        isoDay ??
        (bandcampDay
            ? `${sourceYear}-${String(months.indexOf(sourceMonth) + 1).padStart(2, '0')}-${sourceDay.padStart(2, '0')}`
            : null)
    const result = calendarDaySchema.safeParse(day)
    return result.success ? result.data : null
}

const bandcampReleaseDateSchema = z.string().transform(parseBandcampReleaseDate).nullish()

export type BandData = {
    name: string
    imageUrl: string | null
    location: string | null
    bio: string | null
    links: { url: string; text: string }[]
}

export type ScrapedTralbumInfo = {
    title: string | null
    artist: string | null
    releaseDate: CalendarDay | null
    type: 'album' | 'track'
    id: number | null
    artworkUrl: string | null
    about: string
    aboutLinks: { url: string; text: string }[]
    band: BandData | null
    tracks: {
        title: string
        id: number | null
        artist: string | null
        duration: number
        titleLink: string | null
        albumPreorder: boolean
        streamUrl: string | null
    }[]
}
export const tralbumDataAttrSchema = z.object({
    current: z.object({
        title: z.string(),
        artist: z.string().nullish(),
        about: z.string().nullish(),
        credits: z.string().nullish(),
        release_date: bandcampReleaseDateSchema,
        type: z.enum(['album', 'track']),
        id: z.number(),
    }),
    is_preorder: z.boolean().nullish(),
    album_is_preorder: z.boolean().nullish(),
    album_release_date: bandcampReleaseDateSchema,
    trackinfo: z
        .object({
            title: z.string(),
            duration: z.number(),
            id: z.number().nullish(),
            artist: z.string().nullish(),
            title_link: z.string().nullish(),
            album_preorder: z.boolean(),
            file: z.object({ 'mp3-128': z.string() }).nullish(),
        })
        .array(),
})
export type AttributeTralbumData = z.infer<typeof tralbumDataAttrSchema>
