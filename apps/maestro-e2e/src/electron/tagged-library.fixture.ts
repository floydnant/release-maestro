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
 */
export const DEFAULT_LIBRARY: TaggedTrackSpec[] = [
    { fileName: '01-dawn.mp3', title: 'Dawn', artist: 'Aurora Fields', album: 'Daybreak', cover: 'red' },
    { fileName: '02-noon.mp3', title: 'Noon', artist: 'Aurora Fields', album: 'Daybreak', cover: 'red' },
    { fileName: '03-dusk.mp3', title: 'Dusk', artist: 'Night Cartel', album: 'Afterglow', cover: 'blue' },
    { fileName: '04-void.mp3', title: 'Void', artist: 'Night Cartel', album: 'Afterglow', cover: 'blue' },
    {
        fileName: '05-tide.mp3',
        title: 'Tide',
        artist: 'Seafoam',
        album: 'Undertow',
        cover: 'green',
        coverSalt: 'shared-artwork',
    },
    {
        fileName: '06-gleam.mp3',
        title: 'Gleam',
        artist: 'Brasswork',
        album: 'Filaments',
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

const buildId3Tag = (spec: TaggedTrackSpec): Buffer => {
    const frames = Buffer.concat([
        textFrame('TIT2', spec.title),
        textFrame('TPE1', spec.artist),
        textFrame('TALB', spec.album),
        ...(spec.cover ? [coverFrame(coverPngs[spec.cover], spec.coverSalt ?? spec.album)] : []),
    ])
    return Buffer.concat([Buffer.from('ID3\x03\x00\x00', 'latin1'), syncsafe(frames.length), frames])
}

/** Strip an existing ID3v2 tag so the injected one is the only tag readers see. */
const stripId3 = (data: Buffer): Buffer => {
    if (data.subarray(0, 3).toString('latin1') !== 'ID3') return data
    const size =
        ((data[6] & 0x7f) << 21) | ((data[7] & 0x7f) << 14) | ((data[8] & 0x7f) << 7) | (data[9] & 0x7f)
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
