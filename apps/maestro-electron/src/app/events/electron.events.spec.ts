import { EventEmitter } from 'node:events'

const mockIpcMain = Object.assign(new EventEmitter(), { handle: jest.fn() })
const mockExit = jest.fn<void, [number]>()
const mockStop = jest.fn<Promise<void>, []>()
const mockDestroyAll = jest.fn<Promise<void>, []>()
const mockGet = jest.fn(async () => ({ stop: mockStop }))

jest.mock('electron', () => ({
    app: { exit: mockExit },
    BrowserWindow: {},
    ipcMain: mockIpcMain,
}))
jest.mock('../di', () => ({ diContainer: { get: mockGet, destroyAll: mockDestroyAll } }))
jest.mock('../services/feed/email-import.service', () => ({ EmailImportService: class {} }))
jest.mock('../../environments/environment', () => ({ environment: { version: 'test' } }))

describe('quit IPC', () => {
    beforeEach(() => {
        jest.resetModules()
        jest.resetAllMocks()
        mockIpcMain.removeAllListeners()
        mockGet.mockResolvedValue({ stop: mockStop })
        mockStop.mockResolvedValue(undefined)
        mockDestroyAll.mockResolvedValue(undefined)
    })

    afterEach(() => jest.restoreAllMocks())

    it('drains the import and destroys services before exiting with the requested code', async () => {
        await import('./electron.events')
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
        const exited = new Promise<void>(resolve => {
            mockExit.mockImplementation(() => resolve())
        })

        mockIpcMain.emit('quit', {}, 17)
        expect(mockExit).not.toHaveBeenCalled()
        await stopStarted
        expect(mockDestroyAll).not.toHaveBeenCalled()

        finishStop()
        await destroyStarted
        expect(mockExit).not.toHaveBeenCalled()

        finishDestroy()
        await exited
        expect(mockExit).toHaveBeenCalledWith(17)
        expect(mockExit).toHaveBeenCalledTimes(1)
    })

    it('logs cleanup failure and still exits with the requested code', async () => {
        await import('./electron.events')
        const failure = new Error('database cleanup failed')
        mockDestroyAll.mockRejectedValue(failure)
        const consoleError = jest.spyOn(console, 'error').mockImplementation(() => undefined)
        const exited = new Promise<void>(resolve => {
            mockExit.mockImplementation(() => resolve())
        })

        mockIpcMain.emit('quit', {}, 23)
        await exited

        expect(consoleError).toHaveBeenCalledWith('Error during cleanup:', failure)
        expect(consoleError).toHaveBeenCalledTimes(1)
        expect(mockExit).toHaveBeenCalledWith(23)
    })

    it('joins cleanup already requested by an ordinary quit', async () => {
        await import('./electron.events')
        const { cleanupApplication } = await import('../app-shutdown')
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
        const exited = new Promise<void>(resolve => {
            mockExit.mockImplementation(() => resolve())
        })

        const firstCleanup = cleanupApplication()
        expect(cleanupApplication()).toBe(firstCleanup)
        mockIpcMain.emit('quit', {}, 31)
        await stopStarted
        expect(mockStop).toHaveBeenCalledTimes(1)
        expect(mockExit).not.toHaveBeenCalled()

        finishStop()
        await Promise.all([firstCleanup, exited])

        expect(mockGet).toHaveBeenCalledTimes(1)
        expect(mockDestroyAll).toHaveBeenCalledTimes(1)
        expect(mockExit).toHaveBeenCalledWith(31)
    })
})
