const openExternal = jest.fn().mockResolvedValue(undefined)
const setWindowOpenHandler = jest.fn()
const onWebContents = jest.fn()
const mainWindow = {
    loadURL: jest.fn(),
    on: jest.fn(),
    once: jest.fn(),
    setMenu: jest.fn(),
    webContents: {
        getURL: jest.fn(() => 'http://localhost:4200'),
        on: onWebContents,
        setWindowOpenHandler,
    },
}
const BrowserWindow = jest.fn(() => mainWindow)

jest.mock('electron', () => ({
    BrowserWindow,
    screen: {
        getPrimaryDisplay: () => ({ workAreaSize: { height: 800, width: 1200 } }),
    },
    session: { defaultSession: {} },
    shell: { openExternal },
}))
jest.mock('../environments/environment', () => ({
    environment: { production: false },
}))

import App from './app'

describe('App main window', () => {
    beforeEach(() => {
        jest.clearAllMocks()
        App.mainWindow = null
    })

    it('opens links that request a new window in the native browser', () => {
        App['initMainWindow']()

        expect(setWindowOpenHandler).toHaveBeenCalledTimes(1)
        const handleWindowOpen = setWindowOpenHandler.mock.calls[0]![0]
        const result = handleWindowOpen({ url: 'https://artist.bandcamp.com/album/release' })

        expect(openExternal).toHaveBeenCalledWith('https://artist.bandcamp.com/album/release')
        expect(result).toEqual({ action: 'deny' })
    })

    it.each(['file:///tmp/private-file', 'not a URL'])('blocks an unsafe new-window URL: %s', url => {
        App['initMainWindow']()

        const handleWindowOpen = setWindowOpenHandler.mock.calls[0]![0]

        expect(handleWindowOpen({ url })).toEqual({ action: 'deny' })
        expect(openExternal).not.toHaveBeenCalled()
    })

    it('opens links that navigate the primary window in the native browser', () => {
        App['initMainWindow']()

        expect(onWebContents).toHaveBeenCalledWith('will-navigate', expect.any(Function))
        const handleNavigation = onWebContents.mock.calls.find(
            ([eventName]) => eventName === 'will-navigate',
        )![1]
        const event = { preventDefault: jest.fn() }
        handleNavigation(event, 'https://artist.bandcamp.com/album/release')

        expect(event.preventDefault).toHaveBeenCalledTimes(1)
        expect(openExternal).toHaveBeenCalledWith('https://artist.bandcamp.com/album/release')
    })

    it('allows dev renderer reloads to navigate the primary window', () => {
        App['initMainWindow']()

        const handleNavigation = onWebContents.mock.calls.find(
            ([eventName]) => eventName === 'will-navigate',
        )![1]
        const event = { preventDefault: jest.fn() }
        handleNavigation(event, 'http://localhost:4200/feed')

        expect(event.preventDefault).not.toHaveBeenCalled()
        expect(openExternal).not.toHaveBeenCalled()
    })
})
