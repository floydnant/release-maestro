import { PrescanFileFact, SongMetadata } from '@release-maestro/core'
import { createHash } from 'crypto'
import { ExternalRefKeys, ExternalRefs, NormalizationIssue } from '../../database/drizzle.schema'

const MULTI_VALUE_SEPARATOR = /(?:\s(?:&|feat\.?|ft\.?|vs\.?|x|×)\s|[;/,])/i
const EXTERNAL_REF_KEYS: Record<string, string> = {}
for (const [key, value] of Object.entries(ExternalRefKeys)) {
    EXTERNAL_REF_KEYS[key.toUpperCase()] = value
}

export const normalizeDisplayText = (value: string | null | undefined): string | null => {
    const normalized = value?.trim().replace(/\s+/g, ' ')
    return normalized ? normalized : null
}

const stableValue = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(stableValue)
    if (value && typeof value == 'object') {
        return Object.fromEntries(
            Object.entries(value)
                .sort(([left], [right]) => left.localeCompare(right))
                .map(([key, child]) => [key, stableValue(child)]),
        )
    }
    return value
}

export const stableHash = (value: unknown): string =>
    createHash('sha256')
        .update(JSON.stringify(stableValue(value)))
        .digest('hex')

export const fileFingerprint = (fact: PrescanFileFact): string =>
    stableHash({
        modifiedAt: fact.modifiedAt,
        path: fact.path,
        size: fact.size,
    })

export const albumIdentityKey = (metadata: SongMetadata): string =>
    stableHash({
        albumArtist: normalizeDisplayText(metadata.albumArtist),
        catalogNumber: normalizeDisplayText(metadata.catalogNumber),
        date: normalizeDisplayText(metadata.date),
        label: normalizeDisplayText(metadata.label),
        title: normalizeDisplayText(metadata.albumTitle),
        year: metadata.year,
    })

export const metadataHash = (metadata: SongMetadata): string =>
    stableHash({
        albumArtist: normalizeDisplayText(metadata.albumArtist),
        albumTitle: normalizeDisplayText(metadata.albumTitle),
        artist: normalizeDisplayText(metadata.artist),
        catalogNumber: normalizeDisplayText(metadata.catalogNumber),
        comment: normalizeDisplayText(metadata.comment),
        coverPath: metadata.coverPath,
        date: normalizeDisplayText(metadata.date),
        duration: metadata.duration,
        fileInfo: metadata.fileInfo,
        genre: normalizeDisplayText(metadata.genre),
        label: normalizeDisplayText(metadata.label),
        lyrics: metadata.lyrics,
        bpm: metadata.bpm,
        musicalKey: normalizeDisplayText(metadata.musicalKey),
        energy: normalizeDisplayText(metadata.energy),
        title: normalizeDisplayText(metadata.title),
        track: metadata.track,
        year: metadata.year,
        externalRefs: extractExternalRefs(metadata.extraMetadata, metadata.comment),
    })

const canonicalExtraMetadataKey = (key: string): string =>
    key
        .replace(/^Custom:\s*/i, '')
        .replace(/[^a-z0-9]/gi, '')
        .toUpperCase()

export const extractExternalRefs = (
    extraMetadata: SongMetadata['extraMetadata'],
    comment: string | null,
): ExternalRefs => {
    const refs: Record<string, string[]> = {}

    for (const [rawKey, rawValue] of extraMetadata) {
        const key = EXTERNAL_REF_KEYS[canonicalExtraMetadataKey(rawKey)]
        const value = rawValue.trim()
        if (!key || !value) continue
        refs[key] ??= []
        if (!refs[key].includes(value)) refs[key].push(value)
    }
    const commentBandcampUrl = comment?.match(/https?:\/\/[^\s]+bandcamp\.com[^\s]*/i)?.[0]
    if (commentBandcampUrl) {
        refs[ExternalRefKeys.BandcampLabelUrl] ??= []
        if (commentBandcampUrl && !refs[ExternalRefKeys.BandcampLabelUrl].includes(commentBandcampUrl))
            refs[ExternalRefKeys.BandcampLabelUrl].push(commentBandcampUrl)
    }

    return refs
}

export const mergeExternalRefs = (refsList: (ExternalRefs | undefined)[]): ExternalRefs => {
    const merged: Record<string, string[]> = {}
    for (const refs of refsList) {
        if (!refs) continue
        for (const [key, value] of Object.entries(refs)) {
            if (!value) continue
            merged[key] ??= []
            const values = Array.isArray(value) ? value : [value]
            for (const v of values) {
                if (v && !merged[key].includes(v)) merged[key].push(v)
            }
        }
    }
    return merged
}

export const relevantExternalRefsMap = {
    artists: [
        ExternalRefKeys.MusicBrainzArtistId,
        ExternalRefKeys.DiscogsArtistLink,
        ExternalRefKeys.BeatportArtistUrl,
        ExternalRefKeys.BandcampArtistId,
    ],
    albums: [
        ExternalRefKeys.MusicBrainzReleaseId,
        ExternalRefKeys.MusicBrainzReleaseGroupId,
        ExternalRefKeys.MusicBrainzAlbumId,
        ExternalRefKeys.DiscogsReleaseId,
        ExternalRefKeys.BeatportReleaseId,
        ExternalRefKeys.BandcampReleaseId,
    ],
    labels: [
        ExternalRefKeys.MusicBrainzLabelId,
        ExternalRefKeys.DiscogsLabelLink,
        ExternalRefKeys.BandcampLabelId,
    ],
    // For completeness. Not filtering tracks as they always need to
    // retain the full list of references present in the metadata.
    tracks: Object.values(ExternalRefKeys),
} satisfies Record<string, ExternalRefKeys[]>

export const filterExternalRefs = (refs: ExternalRefs, keys: ExternalRefKeys[]): ExternalRefs => {
    const filtered: ExternalRefs = {}
    for (const key of keys) {
        if (refs[key]) filtered[key] = refs[key]
    }
    return filtered
}

export const detectNormalizationIssues = (metadata: SongMetadata): NormalizationIssue[] => {
    const artist = normalizeDisplayText(metadata.artist)
    const albumArtist = normalizeDisplayText(metadata.albumArtist)
    const albumTitle = normalizeDisplayText(metadata.albumTitle)
    const genre = normalizeDisplayText(metadata.genre)
    const label = normalizeDisplayText(metadata.label)
    const title = normalizeDisplayText(metadata.title)
    const issues: NormalizationIssue[] = []

    if (!artist) issues.push({ type: 'ARTIST_MISSING', field: 'ARTIST' })
    if (albumTitle && !albumArtist) {
        issues.push({ type: 'ALBUM_ARTIST_MISSING', field: 'ALBUM_ARTIST' })
    }
    if (!albumTitle) issues.push({ type: 'ALBUM_TITLE_MISSING', field: 'ALBUM_TITLE' })
    if (artist && MULTI_VALUE_SEPARATOR.test(artist)) {
        issues.push({ type: 'ARTIST_LOOKS_MULTI_VALUE', field: 'ARTIST', value: artist })
    }
    if (albumArtist && MULTI_VALUE_SEPARATOR.test(albumArtist)) {
        issues.push({ type: 'ALBUM_ARTIST_LOOKS_MULTI_VALUE', field: 'ALBUM_ARTIST', value: albumArtist })
    }
    if (genre && MULTI_VALUE_SEPARATOR.test(genre)) {
        issues.push({ type: 'GENRE_LOOKS_MULTI_VALUE', field: 'GENRE', value: genre })
    }
    if (title?.includes(' - ')) {
        issues.push({
            type: 'TITLE_CONTAINS_ARTIST_SEPARATOR',
            field: 'TITLE',
            value: title,
        })
    }
    if (artist && label && artist.localeCompare(label, undefined, { sensitivity: 'accent' }) == 0) {
        issues.push({ type: 'ARTIST_EQUALS_LABEL', field: 'ARTIST', value: artist })
    }
    if (!genre) issues.push({ type: 'GENRE_MISSING', field: 'GENRE' })

    return issues
}
