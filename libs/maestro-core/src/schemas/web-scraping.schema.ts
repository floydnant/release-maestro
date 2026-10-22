import z from 'zod'

export const loadLinkPreviewsRequestSchema = z.object({
    urls: z.array(z.url({ protocol: /^https?$/ })),
})
export type LoadLinkPreviewsRequest = z.infer<typeof loadLinkPreviewsRequestSchema>

export type ScrapedLinkMetadata = {
    url: string
    title: string | null
    description: string | null
    image: string | null
    favicon: string
}
