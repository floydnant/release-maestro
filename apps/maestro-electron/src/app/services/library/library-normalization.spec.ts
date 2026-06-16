import { newSongFixture } from '../../../test/fixtures/song-metadata.fixture'
import { ExternalRefs } from '../../database/drizzle.schema'
import {
    detectNormalizationIssues,
    extractExternalRefs,
    fileFingerprint,
    metadataHash,
    normalizeDisplayText,
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
            'album_artist_missing',
            'artist_looks_multi_value',
            'artist_equals_label',
        ])
    })
})
