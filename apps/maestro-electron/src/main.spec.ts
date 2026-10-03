import { EventEmitter } from 'node:events'

const mockApp = Object.assign(new EventEmitter(), {
    quit: jest.fn(),
    setName: jest.fn(),
})
const mockStop = jest.fn<Promise<void>, []>()
const mockDestroyAll = jest.fn<Promise<void>, []>()
const mockGet = jest.fn(async () => ({ stop: mockStop }))

jest.mock('dotenv/config', () => ({}))
jest.mock('electron', () => ({ app: mockApp, BrowserWindow: {} }))
jest.mock('./app/app', () => ({
    __esModule: true,
    default: { main: jest.fn(), isDevelopmentMode: () => true },
}))
jest.mock('./app/constants', () => ({ developmentAppName: null }))
jest.mock('./app/events/squirrel.events', () => ({
    __esModule: true,
    default: { handleEvents: () => false },
}))
jest.mock('./app/events/electron.events', () => ({
    __esModule: true,
    default: { bootstrapElectronEvents: jest.fn() },
}))
jest.mock('./app/events/app.events', () => ({
    __esModule: true,
    default: { bootstrapAppEvents: jest.fn() },
}))
jest.mock('./app/events/update.events', () => ({
    __esModule: true,
    default: { initAutoUpdateService: jest.fn() },
}))
jest.mock('./app/di', () => ({ diContainer: { get: mockGet, destroyAll: mockDestroyAll } }))
jest.mock('./app/services/feed/email-import.service', () => ({ EmailImportService: class {} }))

describe('main-process shutdown', () => {
    beforeEach(() => {
        jest.resetModules()
        jest.resetAllMocks()
        mockApp.removeAllListeners()
        mockGet.mockResolvedValue({ stop: mockStop })
        mockStop.mockResolvedValue(undefined)
        mockDestroyAll.mockResolvedValue(undefined)
    })

    afterEach(() => jest.restoreAllMocks())

    it('keeps services alive when the last macOS window closes', async () => {
        await import('./main')

        mockApp.emit('window-all-closed')
        await new Promise<void>(resolve => setImmediate(resolve))

        expect(mockDestroyAll).not.toHaveBeenCalled()
        expect(mockStop).not.toHaveBeenCalled()
    })

    it('prevents quitting until the import has drained and services have been destroyed', async () => {
        await import('./main')
        let finishStop: () => void = () => undefined
        const draining = new Promise<void>(resolve => {
            finishStop = resolve
        })
        const stopStarted = new Promise<void>(resolve => {
            mockStop.mockImplementation(() => {
                resolve()
                return draining
            })
        })
        let finishDestroy: () => void = () => undefined
        const destroying = new Promise<void>(resolve => {
            finishDestroy = resolve
        })
        const destroyStarted = new Promise<void>(resolve => {
            mockDestroyAll.mockImplementation(() => {
                resolve()
                return destroying
            })
        })
        const event = { preventDefault: jest.fn() }

        mockApp.emit('before-quit', event)

        expect(event.preventDefault).toHaveBeenCalledTimes(1)
        await stopStarted
        expect(mockDestroyAll).not.toHaveBeenCalled()

        const repeatedQuit = { preventDefault: jest.fn() }
        mockApp.emit('before-quit', repeatedQuit)
        expect(repeatedQuit.preventDefault).toHaveBeenCalledTimes(1)
        expect(mockStop).toHaveBeenCalledTimes(1)

        finishStop()
        await destroyStarted
        expect(mockApp.quit).not.toHaveBeenCalled()

        const quitRequested = new Promise<void>(resolve => {
            mockApp.quit.mockImplementation(() => {
                const finalQuit = { preventDefault: jest.fn() }
                mockApp.emit('before-quit', finalQuit)
                expect(finalQuit.preventDefault).not.toHaveBeenCalled()
                resolve()
            })
        })
        finishDestroy()
        await quitRequested
        expect(mockGet).toHaveBeenCalledTimes(1)
        expect(mockDestroyAll).toHaveBeenCalledTimes(1)
        expect(mockApp.quit).toHaveBeenCalledTimes(1)
    })

    it('still quits if dependency cleanup fails', async () => {
        await import('./main')
        const failure = new Error('database cleanup failed')
        mockDestroyAll.mockRejectedValue(failure)
        const consoleError = jest.spyOn(console, 'error').mockImplementation(() => undefined)
        const quitRequested = new Promise<void>(resolve => {
            mockApp.quit.mockImplementation(resolve)
        })

        mockApp.emit('before-quit', { preventDefault: jest.fn() })
        await quitRequested

        expect(consoleError).toHaveBeenCalledWith('Error during cleanup:', failure)
        consoleError.mockRestore()
    })
})
