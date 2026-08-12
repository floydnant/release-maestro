import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { Page, Route } from '@playwright/test'

const workspaceRoot = join(__dirname, '../../../..')
const audioFixturePath = join(workspaceRoot, 'fixtures/06-karasu-ktmp3.mp3')

/** A reserved URL that can never resolve over the public network. */
export const audioFixtureUrl = 'https://audio.release-maestro.invalid/06-karasu-ktmp3.mp3'

const requestedByteRange = (route: Route, size: number): { start: number; end: number } | null => {
    const range = route.request().headers()['range']
    if (!range) return null

    const match = /^bytes=(\d*)-(\d*)$/.exec(range)
    if (!match) throw new Error(`Unsupported audio fixture range: ${range}`)

    const [, startText, endText] = match
    const start = startText ? Number(startText) : Math.max(0, size - Number(endText))
    const end = endText && startText ? Number(endText) : size - 1

    if (
        !Number.isSafeInteger(start) ||
        !Number.isSafeInteger(end) ||
        start < 0 ||
        end < start ||
        start >= size
    ) {
        throw new Error(`Invalid audio fixture range: ${range}`)
    }

    return { start, end: Math.min(end, size - 1) }
}

/** Serve the committed MP3 to Chromium without any network access. */
export const installAudioFixtureRoute = async (page: Page): Promise<void> => {
    const audio = await readFile(audioFixturePath)

    await page.route(audioFixtureUrl, async route => {
        const range = requestedByteRange(route, audio.length)
        const body = range ? audio.subarray(range.start, range.end + 1) : audio

        await route.fulfill({
            body,
            contentType: 'audio/mpeg',
            status: range ? 206 : 200,
            headers: {
                'Accept-Ranges': 'bytes',
                'Content-Length': String(body.length),
                ...(range ? { 'Content-Range': `bytes ${range.start}-${range.end}/${audio.length}` } : {}),
            },
        })
    })
}
