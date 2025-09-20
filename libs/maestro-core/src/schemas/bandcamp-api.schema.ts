import z from 'zod'

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
    releaseDate: string | null
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
        release_date: z.string().nullish(),
        type: z.enum(['album', 'track']),
        id: z.number(),
    }),
    is_preorder: z.boolean().nullish(),
    album_is_preorder: z.boolean().nullish(),
    album_release_date: z.string().nullish(),
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
