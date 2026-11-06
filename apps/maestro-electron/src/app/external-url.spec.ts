const openExternal = jest.fn().mockResolvedValue(undefined)

jest.mock('electron', () => ({ shell: { openExternal } }))

import { openUrlInNativeBrowser } from './external-url'

describe('external URL boundary', () => {
    beforeEach(() => jest.clearAllMocks())
    afterEach(() => jest.restoreAllMocks())

    it.each(['https://artist.bandcamp.com/album/release', 'http://example.com'])('opens %s', url => {
        openUrlInNativeBrowser(url)
        expect(openExternal).toHaveBeenCalledWith(url)
    })

    it.each(['file:///tmp/music', 'javascript:alert(1)', 'custom-handler:command', 'invalid'])(
        'rejects and logs %s',
        url => {
            const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined)

            openUrlInNativeBrowser(url)

            expect(openExternal).not.toHaveBeenCalled()
            expect(warn).toHaveBeenCalledWith(expect.any(String), url)
        },
    )
})
