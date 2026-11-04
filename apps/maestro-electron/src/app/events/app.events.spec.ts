const openExternal = jest.fn().mockResolvedValue(undefined)
const handle = jest.fn<void, [string, (event: unknown, url: string) => Promise<void>]>()

jest.mock('electron', () => ({
    ipcMain: { handle, on: jest.fn() },
    shell: { openExternal },
}))
jest.mock('../app', () => ({ __esModule: true, default: {} }))
jest.mock('../di', () => ({ diContainer: {} }))
jest.mock('../services/library/library-browse.repository', () => ({}))
jest.mock('../services/library/library-folders.service', () => ({}))
jest.mock('../services/library/library-scan.service', () => ({}))
jest.mock('../services/metadata/metadata.backend.service', () => ({}))
jest.mock('../services/settings.backend.service', () => ({}))

describe('open-url IPC boundary', () => {
    beforeEach(() => {
        jest.resetModules()
        jest.clearAllMocks()
    })

    it.each([
        ['https://artist.bandcamp.com/album/release', true],
        ['http://example.com', true],
        ['file:///tmp/music', false],
        ['javascript:alert(1)', false],
        ['custom-handler:command', false],
        ['invalid', false],
    ])('handles %s through the registered IPC handler', async (url, allowed) => {
        await import('./app.events')
        const registration = handle.mock.calls.find(([channel]) => channel === 'open-url')
        if (!registration) throw new Error('open-url IPC handler was not registered')

        await registration[1]({}, url)

        if (allowed) {
            expect(openExternal).toHaveBeenCalledTimes(1)
            expect(openExternal).toHaveBeenCalledWith(url)
        } else {
            expect(openExternal).not.toHaveBeenCalled()
        }
    })
})
