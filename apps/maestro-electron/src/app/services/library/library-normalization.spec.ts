import { newSongFixture } from '../../../test/fixtures/song-metadata.fixture'
import { ExternalRefs, NormalizationIssueType } from '../../database/drizzle.schema'
import {
    albumIdentityKey,
    detectNormalizationIssues,
    extractExternalRefs,
    fileFingerprint,
    metadataHash,
    normalizeDisplayText,
    yearFromMetadata,
} from './library-normalization'

describe('library normalization', () => {
    it('normalizes display whitespace without changing source data', () => {
        expect(normalizeDisplayText('  Artist   Name  ')).toBe('Artist Name')
        expect(normalizeDisplayText('   ')).toBeNull()
    })

    it('uses file path, size, and modified time for the fast fingerprint', () => {
        const base = {
            path: '/music/song.flac',
            fileName: 'song.flac',
            size: 100,
            modifiedAt: 1_000,
        }

        expect(fileFingerprint(base)).toBe(fileFingerprint({ ...base }))
        expect(fileFingerprint(base)).not.toBe(fileFingerprint({ ...base, modifiedAt: 1_001 }))
    })

    it('hashes semantic metadata deterministically without extra metadata noise', () => {
        const first = newSongFixture({
            title: ' Song ',
            extraMetadata: [['Custom: SERATO_PLAYCOUNT', '1']],
        })
        const second = newSongFixture({
            title: 'Song',
            extraMetadata: [['Custom: SERATO_PLAYCOUNT', '2']],
        })

        expect(metadataHash(first)).toBe(metadataHash(second))
    })
    it('hashes semantic metadata deterministically honoring external refs metadata keys', () => {
        const first = newSongFixture({
            title: ' Song ',
            extraMetadata: [['MUSICBRAINZ_RECORDING_ID', 'one']],
        })
        const second = newSongFixture({
            title: 'Song',
            extraMetadata: [
                ['MUSICBRAINZ_RECORDING_ID', 'one'],
                ['MUSICBRAINZ_TRACK_ID', 'two'],
            ],
        })

        expect(metadataHash(first)).not.toBe(metadataHash(second))
    })

    it('canonicalizes supported external reference tag names', () => {
        expect(
            extractExternalRefs(
                [
                    ['Custom: MUSICBRAINZ_RECORDING_ID', 'recording-1'],
                    ['Bandcamp Url', 'https://example.bandcamp.com/track/song'],
                ],
                'Visit https://amphibianrecords.bandcamp.com',
            ),
        ).toEqual({
            MUSICBRAINZ_RECORDING_ID: ['recording-1'],
            BANDCAMP_URL: ['https://example.bandcamp.com/track/song'],
            BANDCAMP_LABEL_URL: ['https://amphibianrecords.bandcamp.com'],
        } satisfies ExternalRefs)
    })

    it.each([
        ['Custom: Acoustid Id', 'ACOUSTID_ID'],
        ['Isrc', 'ISRC'],
        ['Barcode', 'BARCODE'],
        ['Custom: UPC', 'BARCODE'],
        ['Custom: EAN', 'BARCODE'],
        ['Custom: EAN/UPN', 'BARCODE'],
        ['Custom: UPN', 'BARCODE'],
        ['Custom: DISCOGS_MASTER_RELEASE_ID', 'DISCOGS_MASTER_RELEASE_ID'],
        ['Custom: DISCOGS_ARTIST_ID', 'DISCOGS_ARTIST_ID'],
        ['Custom: DISCOGS_LABEL_ID', 'DISCOGS_LABEL_ID'],
        ['Custom: ASIN', 'ASIN'],
        ['Custom: SPOTIFY_TRACK_ID', 'SPOTIFY_TRACK_ID'],
        ['Custom: SPOTIFY_RELEASE_ID', 'SPOTIFY_RELEASE_ID'],
        ['Custom: DEEZER_TRACK_ID', 'DEEZER_TRACK_ID'],
        ['Custom: DEEZER_RELEASE_ID', 'DEEZER_RELEASE_ID'],
        ['Custom: TRAXSOURCE_TRACK_ID', 'TRAXSOURCE_TRACK_ID'],
        ['Custom: TRAXSOURCE_RELEASE_ID', 'TRAXSOURCE_RELEASE_ID'],
        ['Custom: BEATSOURCE_TRACK_ID', 'BEATSOURCE_TRACK_ID'],
        ['Custom: BEATSOURCE_RELEASE_ID', 'BEATSOURCE_RELEASE_ID'],
        ['Custom: ITUNES_TRACK_ID', 'ITUNES_TRACK_ID'],
        ['Custom: ITUNES_RELEASE_ID', 'ITUNES_RELEASE_ID'],
        ['Custom: JUNODOWNLOAD_RELEASE_ID', 'JUNODOWNLOAD_RELEASE_ID'],
    ])('imports %s under %s', (rawKey, key) => {
        expect(extractExternalRefs([[rawKey, ' 001234 ']], null)).toEqual({ [key]: ['001234'] })
    })

    it('reads Apple MP4 freeform references and deduplicates aliases without losing values', () => {
        expect(
            extractExternalRefs(
                [
                    ['Custom: ----:com.apple.iTunes:Acoustid Id', 'acoustid-1'],
                    ['Custom: ACOUSTID_ID', ' acoustid-1 '],
                    ['Custom: ----:com.apple.iTunes:SPOTIFY_TRACK_ID', 'spotify-1'],
                    ['Custom: ----:com.apple.iTunes:DISCOGS_RELEASE_ID', '123'],
                    ['Custom: UPC', '001234'],
                    ['Barcode', '001234'],
                    ['Custom: EAN', '005678'],
                    ['Isrc', 'GBABC2600001'],
                    ['Isrc', 'GBABC2600002'],
                ],
                null,
            ),
        ).toEqual({
            ACOUSTID_ID: ['acoustid-1'],
            SPOTIFY_TRACK_ID: ['spotify-1'],
            DISCOGS_RELEASE_ID: ['123'],
            BARCODE: ['001234', '005678'],
            ISRC: ['GBABC2600001', 'GBABC2600002'],
        } satisfies ExternalRefs)
    })

    it('ignores blanks, unrelated fields, fingerprints and other MP4 namespaces', () => {
        expect(
            extractExternalRefs(
                [
                    ['Custom: ACOUSTID_ID', '  '],
                    ['Custom: Acoustid Fingerprint', 'opaque-fingerprint'],
                    ['Custom: ----:org.example:SPOTIFY_TRACK_ID', 'private-id'],
                    ['Custom: SPOTIFY_POPULARITY', '80'],
                    ['Custom: URL', 'https://example.com'],
                ],
                null,
            ),
        ).toEqual({})
    })

    it('flags ambiguous artist text without splitting it', () => {
        const issues = detectNormalizationIssues(
            newSongFixture({
                artist: 'Alpha & Beta',
                albumTitle: 'Album',
                albumArtist: null,
                label: 'Alpha & Beta',
            }),
        )

        expect(issues.map(issue => issue.type)).toEqual([
            NormalizationIssueType.AlbumArtistMissing,
            NormalizationIssueType.ArtistLooksMultiValue,
            NormalizationIssueType.ArtistEqualsLabel,
        ])
    })

    describe('yearFromMetadata', () => {
        it('prefers the dedicated year field when a tag actually carries one', () => {
            expect(yearFromMetadata({ year: 1998, date: '2019-05-01' })).toBe(1998)
        })

        it.each([
            ['2019', 2019],
            ['2019-05-01', 2019],
            ['2019/05/01', 2019],
            ['  2021  ', 2021],
        ])('falls back to the leading year of %s', (date, expected) => {
            // MP3s land here rather than in `year`: lofty upgrades ID3v2.3's TYER to
            // TDRC, which is a date, so the year only ever arrives inside `date`.
            expect(yearFromMetadata({ year: null, date })).toBe(expected)
        })

        it.each([[null], [''], ['unknown'], ['99'], ['May 2019']])(
            'refuses to guess a year from %s',
            date => {
                expect(yearFromMetadata({ year: null, date })).toBeNull()
            },
        )
    })

    describe('albumIdentityKey', () => {
        it('is stable for an unchanged tag, which is what keeps an album findable', () => {
            // The key is stored under a unique index and is how an album is matched on
            // the next scan. Anything that changes it re-keys every album already in
            // the database and orphans its songs, so this pins it against drift.
            const metadata = newSongFixture({ year: 2019, date: '2019-05-01' })

            expect(albumIdentityKey(metadata)).toBe(albumIdentityKey(newSongFixture({ ...metadata })))
        })
    })
})
