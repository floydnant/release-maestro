import { join, resolve } from 'node:path'

describe('appPaths', () => {
    const originalOverride = process.env.RELEASE_MAESTRO_APP_DATA_DIR

    afterEach(() => {
        jest.resetModules()
        jest.unmock('electron')
        jest.unmock('env-paths')
        if (originalOverride === undefined) delete process.env.RELEASE_MAESTRO_APP_DATA_DIR
        else process.env.RELEASE_MAESTRO_APP_DATA_DIR = originalOverride
    })

    it('uses the explicit app-data directory for a packaged app', async () => {
        const appDataDir = 'relative-test-app-data'
        process.env.RELEASE_MAESTRO_APP_DATA_DIR = appDataDir
        jest.doMock('electron', () => ({
            app: { isPackaged: true },
        }))
        jest.doMock('env-paths', () => ({ __esModule: true, default: jest.fn() }))

        const { appPaths } = await import('./app-env')
        const root = resolve(appDataDir)

        expect(appPaths).toMatchObject({
            cache: join(root, 'cache'),
            log: join(root, 'log'),
            temp: join(root, 'temp'),
            data: join(root, 'data'),
            config: join(root, 'config'),
        })
    })
})
