const openExternal = jest.fn().mockResolvedValue(undefined)
const handle = jest.fn<void, [string, (event: unknown, url: string) => Promise<void>]>()

jest.mock('electron', () => ({
    ipcMain: { handle, on: jest.fn() },
    shell: { openExternal },
}))
// app.events registers every handler on import; stub its service dependencies so only the
// `open-url` wiring is exercised.
jest.mock('../app', () => ({ __esModule: true, default: {} }))
jest.mock('../di', () => ({ diContainer: {} }))
jest.mock('../services/library/library-browse.repository', () => ({}))
jest.mock('../services/library/library-folders.service', () => ({}))
jest.mock('../services/library/library-scan.service', () => ({}))
jest.mock('../services/metadata/metadata.backend.service', () => ({}))
jest.mock('../services/settings.backend.service', () => ({}))

import './app.events'

const openUrlHandler = (() => {
    const registration = handle.mock.calls.find(([channel]) => channel === 'open-url')
    // Fail loudly: with no handler the rejection cases below would pass without testing anything.
    if (!registration) throw new Error('open-url IPC handler was not registered')
    return registration[1]
})()

describe('open-url IPC boundary', () => {
    beforeEach(() => {
        openExternal.mockClear()
        jest.spyOn(console, 'warn').mockImplementation(() => undefined)
    })
    afterEach(() => jest.restoreAllMocks())

    it.each(['https://artist.bandcamp.com/album/release', 'http://example.com'])('opens %s', async url => {
        await openUrlHandler({}, url)
        expect(openExternal).toHaveBeenCalledTimes(1)
        expect(openExternal).toHaveBeenCalledWith(url)
        expect(console.warn).not.toHaveBeenCalled()
    })

    it.each(['file:///tmp/music', 'javascript:alert(1)', 'custom-handler:command', 'invalid'])(
        'rejects %s',
        async url => {
            await openUrlHandler({}, url)
            expect(openExternal).not.toHaveBeenCalled()
            expect(console.warn).toHaveBeenCalledWith(expect.any(String), url)
        },
    )
})
