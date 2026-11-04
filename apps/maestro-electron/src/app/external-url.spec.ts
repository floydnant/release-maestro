const openExternal = jest.fn().mockResolvedValue(undefined)

jest.mock('electron', () => ({ shell: { openExternal } }))

import { openUrlInNativeBrowser } from './external-url'

describe('external URL boundary', () => {
    beforeEach(() => jest.clearAllMocks())

    it.each(['https://artist.bandcamp.com/album/release', 'http://example.com'])('opens %s', url => {
        openUrlInNativeBrowser(url)
        expect(openExternal).toHaveBeenCalledWith(url)
    })

    it.each(['file:///tmp/music', 'javascript:alert(1)', 'custom-handler:command', 'invalid'])(
        'rejects %s',
        url => {
            openUrlInNativeBrowser(url)
            expect(openExternal).not.toHaveBeenCalled()
        },
    )
})
