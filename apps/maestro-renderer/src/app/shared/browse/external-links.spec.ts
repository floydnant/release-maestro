import { ExternalRefKeys } from '@release-maestro/core'
import { externalLinks } from './external-links'

describe('externalLinks', () => {
    it('builds ID links and numbers repeats in a stable order', () => {
        expect(
            externalLinks({ [ExternalRefKeys.MusicBrainzLabelId]: ['b', ' a ', 'b', ''] }, [
                {
                    key: ExternalRefKeys.MusicBrainzLabelId,
                    label: 'MusicBrainz',
                    base: 'https://musicbrainz.org/label/',
                },
            ]),
        ).toEqual([
            { label: 'MusicBrainz 1', url: 'https://musicbrainz.org/label/a' },
            { label: 'MusicBrainz 2', url: 'https://musicbrainz.org/label/b' },
        ])
    })

    it('deduplicates and numbers links shared by ID and URL tags', () => {
        expect(
            externalLinks(
                {
                    DISCOGS_ARTIST_ID: ['456', '123'],
                    DISCOGS_ARTIST_LINK: ['https://www.discogs.com/artist/456'],
                },
                [
                    { key: ExternalRefKeys.DiscogsArtistLink, label: 'Discogs', domain: 'discogs.com' },
                    {
                        key: ExternalRefKeys.DiscogsArtistId,
                        label: 'Discogs',
                        base: 'https://www.discogs.com/artist/',
                    },
                ],
            ),
        ).toEqual([
            { label: 'Discogs 1', url: 'https://www.discogs.com/artist/123' },
            { label: 'Discogs 2', url: 'https://www.discogs.com/artist/456' },
        ])
    })

    it('keeps http(s) URLs on the service domain or its subdomains only', () => {
        const refs = {
            [ExternalRefKeys.BandcampLabelUrl]: [
                'https://kosmische.bandcamp.com',
                'http://bandcamp.com/label',
                'https://notbandcamp.com',
                'https://bandcamp.com.example.org',
                'javascript:alert(1)',
                'not a url',
            ],
        }
        expect(
            externalLinks(refs, [
                { key: ExternalRefKeys.BandcampLabelUrl, label: 'Bandcamp', domain: 'bandcamp.com' },
            ]).map(link => link.url),
        ).toEqual(['http://bandcamp.com/label', 'https://kosmische.bandcamp.com'])
    })
})
