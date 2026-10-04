import { createRendererLogger } from './logger'

describe('renderer logging', () => {
    const processDescriptor = Object.getOwnPropertyDescriptor(window, 'process')
    const requireDescriptor = Object.getOwnPropertyDescriptor(window, 'require')

    afterEach(() => {
        jest.restoreAllMocks()
        if (processDescriptor) Object.defineProperty(window, 'process', processDescriptor)
        else Reflect.deleteProperty(window, 'process')
        if (requireDescriptor) Object.defineProperty(window, 'require', requireDescriptor)
        else Reflect.deleteProperty(window, 'require')
    })

    it('writes to the browser console with no Electron runtime', () => {
        Object.defineProperty(window, 'process', { configurable: true, value: undefined })
        const consoleInfo = jest.spyOn(console, 'info').mockImplementation()

        createRendererLogger('feed').info('feed.loaded', { count: 3 })

        expect(consoleInfo).toHaveBeenCalledWith('[feed] feed.loaded', { count: 3 })
    })

    it('writes to the browser console and sends the same event to Electron', () => {
        const send = jest.fn()
        Object.defineProperty(window, 'process', { configurable: true, value: { type: 'renderer' } })
        Object.defineProperty(window, 'require', {
            configurable: true,
            value: () => ({ ipcRenderer: { send } }),
        })
        const consoleWarn = jest.spyOn(console, 'warn').mockImplementation()

        createRendererLogger('feed').warn('feed.retry', { attempt: 2 })

        expect(consoleWarn).toHaveBeenCalledWith('[feed] feed.retry', { attempt: 2 })
        expect(send).toHaveBeenCalledWith('diagnostics:log', {
            level: 'warn',
            scope: 'feed',
            event: 'feed.retry',
            fields: { attempt: 2 },
        })
    })

    it('keeps the browser console available if Electron IPC has closed', () => {
        Object.defineProperty(window, 'process', { configurable: true, value: { type: 'renderer' } })
        Object.defineProperty(window, 'require', {
            configurable: true,
            value: () => ({
                ipcRenderer: {
                    send: () => {
                        throw new Error('closed')
                    },
                },
            }),
        })
        const consoleError = jest.spyOn(console, 'error').mockImplementation()

        expect(() => createRendererLogger('app').error('app.failed', new Error('failure'))).not.toThrow()
        expect(consoleError).toHaveBeenCalledWith(
            '[app] app.failed',
            expect.objectContaining({ errorMessage: 'failure' }),
        )
    })
})
