/**
 * Builds a temp music library of MP3s with distinct ID3v2.3 tags and embedded
 * cover art, by re-tagging the audio of the committed karasu fixture. Lets the
 * import-flow tests exercise album grouping and the cover mosaic without
 * committing more binary fixtures.
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { TestInfo } from '@playwright/test'

const workspaceRoot = join(__dirname, '../../../..')
const sourceFixturePath = join(workspaceRoot, 'fixtures/06-karasu-ktmp3.mp3')

/** 24×24 solid-color PNGs (base64) used as embedded cover art. */
const coverPngs = {
    red: 'iVBORw0KGgoAAAANSUhEUgAAABgAAAAYCAIAAABvFaqvAAAAH0lEQVR4nGM4YWNDFcQwatCoQaMGjRo0atCoQQNvEACSR9AfWEHUdAAAAABJRU5ErkJggg==',
    green: 'iVBORw0KGgoAAAANSUhEUgAAABgAAAAYCAIAAABvFaqvAAAAH0lEQVR4nGOwWRVFFcQwatCoQaMGjRo0atCoQQNvEAATuNAf8SpBJwAAAABJRU5ErkJggg==',
    blue: 'iVBORw0KGgoAAAANSUhEUgAAABgAAAAYCAIAAABvFaqvAAAAH0lEQVR4nGNwizpBFcQwatCoQaMGjRo0atCoQQNvEAA8tSouT9RnqAAAAABJRU5ErkJggg==',
    gold: 'iVBORw0KGgoAAAANSUhEUgAAABgAAAAYCAIAAABvFaqvAAAAH0lEQVR4nGO4s0qDKohh1KBRg0YNGjVo1KBRgwbeIAAH98euAZq92AAAAABJRU5ErkJggg==',
} as const

export interface TaggedTrackSpec {
    fileName: string
    title: string
    artist: string
    album: string
    /**
     * Album-level tags. They feed `albumIdentityKey`, so two tracks meant to sit on
     * the same album must carry identical values — differing on one splits the album
     * in two, which is the brittleness MAE-97 tracks.
     */
    year?: number
    recordLabel?: string
    /** Track-level tags, and what the browse table sorts and filters on. */
    genre?: string
    bpm?: number
    musicalKey?: string
    cover?: keyof typeof coverPngs
    /**
     * Bytes appended after the PNG's IEND chunk (invisible to decoders) so covers
     * with the same base color still content-hash differently. Defaults to the
     * album name, i.e. one distinct artwork per album; pass the same salt on two
     * albums to make them share identical artwork.
     */
    coverSalt?: string
}

/**
 * 6 tracks, 4 albums, 3 distinct artworks: Daybreak (red), Afterglow (blue), and
 * Undertow + Filaments deliberately share one green artwork — the content-addressed
 * cover cache dedupes them to a single mosaic tile.
 *
 * Every value the track table can sort or filter by is distinct across the six, so
 * one ordering never accidentally reproduces another: titles, years, BPMs, keys,
 * durations-by-proxy, genres and record labels all disagree with each other.
 *
 * **Void is credited to two artists in one string.** Ingest does not split raw names
 * — MAE-97 owns that — so it resolves to a single artist entity called
 * `Night Cartel & Aurora Fields`, and the artist credit has exactly one segment.
 * That is the case the browse table has to render verbatim, so the fixture carries
 * it rather than only well-behaved single-artist strings.
 */
export const DEFAULT_LIBRARY: TaggedTrackSpec[] = [
    {
        fileName: '01-dawn.mp3',
        title: 'Dawn',
        artist: 'Aurora Fields',
        album: 'Daybreak',
        year: 2019,
        recordLabel: 'Kosmische',
        genre: 'Ambient',
        bpm: 120,
        musicalKey: '8A',
        cover: 'red',
    },
    {
        fileName: '02-noon.mp3',
        title: 'Noon',
        artist: 'Aurora Fields',
        album: 'Daybreak',
        year: 2019,
        recordLabel: 'Kosmische',
        genre: 'Ambient',
        bpm: 128,
        musicalKey: '9A',
        cover: 'red',
    },
    {
        fileName: '03-dusk.mp3',
        title: 'Dusk',
        artist: 'Night Cartel',
        album: 'Afterglow',
        year: 2021,
        recordLabel: 'Hardwire',
        genre: 'Techno',
        bpm: 140,
        musicalKey: '4A',
        cover: 'blue',
    },
    {
        fileName: '04-void.mp3',
        title: 'Void',
        artist: 'Night Cartel & Aurora Fields',
        album: 'Afterglow',
        year: 2021,
        recordLabel: 'Hardwire',
        genre: 'Techno',
        bpm: 134,
        musicalKey: '11B',
        cover: 'blue',
    },
    {
        fileName: '05-tide.mp3',
        title: 'Tide',
        artist: 'Seafoam',
        album: 'Undertow',
        year: 2017,
        recordLabel: 'Saltmarsh',
        genre: 'Dub',
        bpm: 96,
        musicalKey: '1A',
        cover: 'green',
        coverSalt: 'shared-artwork',
    },
    {
        fileName: '06-gleam.mp3',
        title: 'Gleam',
        artist: 'Brasswork',
        album: 'Filaments',
        year: 2023,
        recordLabel: 'Saltmarsh',
        genre: 'Jazz',
        bpm: 174,
        musicalKey: '12B',
        cover: 'green',
        coverSalt: 'shared-artwork',
    },
]

const uint32be = (value: number): Buffer => {
    const buffer = Buffer.alloc(4)
    buffer.writeUInt32BE(value)
    return buffer
}

const syncsafe = (value: number): Buffer =>
    Buffer.from([(value >> 21) & 0x7f, (value >> 14) & 0x7f, (value >> 7) & 0x7f, value & 0x7f])

/** ID3v2.3 text frame (latin1). */
const textFrame = (id: string, text: string): Buffer => {
    const payload = Buffer.concat([Buffer.from([0x00]), Buffer.from(text, 'latin1')])
    return Buffer.concat([Buffer.from(id, 'latin1'), uint32be(payload.length), Buffer.from([0, 0]), payload])
}

/** ID3v2.3 APIC frame with a PNG front cover (plus a hash-salting trailer, see {@link TaggedTrackSpec}). */
const coverFrame = (pngBase64: string, salt: string): Buffer => {
    const payload = Buffer.concat([
        Buffer.from([0x00]),
        Buffer.from('image/png\0', 'latin1'),
        Buffer.from([0x03]), // picture type: front cover
        Buffer.from('\0', 'latin1'),
        Buffer.from(pngBase64, 'base64'),
        Buffer.from(salt, 'latin1'),
    ])
    return Buffer.concat([
        Buffer.from('APIC', 'latin1'),
        uint32be(payload.length),
        Buffer.from([0, 0]),
        payload,
    ])
}

/** An optional ID3v2.3 text frame, omitted entirely when the spec leaves it out. */
const optionalTextFrame = (id: string, value: string | number | undefined): Buffer[] =>
    value == null ? [] : [textFrame(id, String(value))]

const buildId3Tag = (spec: TaggedTrackSpec): Buffer => {
    const frames = Buffer.concat([
        textFrame('TIT2', spec.title),
        textFrame('TPE1', spec.artist),
        textFrame('TALB', spec.album),
        ...optionalTextFrame('TCON', spec.genre),
        ...optionalTextFrame('TPUB', spec.recordLabel),
        ...optionalTextFrame('TYER', spec.year),
        ...optionalTextFrame('TBPM', spec.bpm),
        ...optionalTextFrame('TKEY', spec.musicalKey),
        ...(spec.cover ? [coverFrame(coverPngs[spec.cover], spec.coverSalt ?? spec.album)] : []),
    ])
    return Buffer.concat([Buffer.from('ID3\x03\x00\x00', 'latin1'), syncsafe(frames.length), frames])
}

/** Strip an existing ID3v2 tag so the injected one is the only tag readers see. */
const stripId3 = (data: Buffer): Buffer => {
    if (data.length < 10 || data.subarray(0, 3).toString('latin1') !== 'ID3') return data
    const size =
        ((data.readUInt8(6) & 0x7f) << 21) |
        ((data.readUInt8(7) & 0x7f) << 14) |
        ((data.readUInt8(8) & 0x7f) << 7) |
        (data.readUInt8(9) & 0x7f)
    return data.subarray(10 + size)
}

/**
 * Writes the tagged library into the test's output dir and returns its path.
 * `audioBytes` optionally truncates the audio stream to keep large generated
 * libraries small and fast (readers tolerate a cut-off final frame).
 */
export const buildTaggedLibrary = async (
    testInfo: TestInfo,
    specs: TaggedTrackSpec[] = DEFAULT_LIBRARY,
    audioBytes?: number,
): Promise<string> => {
    const libraryDir = testInfo.outputPath('library')
    await mkdir(libraryDir, { recursive: true })
    let audio = stripId3(await readFile(sourceFixturePath))
    if (audioBytes) audio = audio.subarray(0, audioBytes)
    for (const spec of specs) {
        await writeFile(join(libraryDir, spec.fileName), Buffer.concat([buildId3Tag(spec), audio]))
    }
    return libraryDir
}
