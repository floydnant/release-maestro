import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
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

describe('resolveMetadataEngineBinaryPath', () => {
    let workspace: string
    const binaryName = process.platform === 'win32' ? 'metadata-engine.exe' : 'metadata-engine'

    beforeEach(async () => {
        workspace = await mkdtemp(join(tmpdir(), 'maestro-engine-path-'))
        jest.doMock('electron', () => ({ app: { isPackaged: false } }))
        jest.doMock('env-paths', () => ({ __esModule: true, default: jest.fn() }))
    })

    afterEach(async () => {
        jest.restoreAllMocks()
        jest.resetModules()
        jest.unmock('electron')
        jest.unmock('env-paths')
        await rm(workspace, { recursive: true, force: true })
    })

    it.each([
        { builds: ['dev/release', 'release', 'debug'] },
        { builds: ['release', 'debug'] },
        { builds: ['debug'] },
        { builds: [] },
    ])('resolves the canonical host binary with existing builds $builds', async ({ builds }) => {
        const { resolveMetadataEngineBinaryPath } = await import('./app-env')
        const target = join(workspace, 'apps', 'metadata-engine', 'target')
        for (const build of builds) {
            await mkdir(join(target, build), { recursive: true })
            await writeFile(join(target, build, binaryName), '')
        }
        jest.spyOn(process, 'cwd').mockReturnValue(workspace)

        await expect(resolveMetadataEngineBinaryPath()).resolves.toBe(
            join(target, 'dev', 'release', binaryName),
        )
    })

    it('resolves the shipped binary for a packaged app', async () => {
        jest.doMock('electron', () => ({ app: { isPackaged: true } }))
        const { appPaths, resolveMetadataEngineBinaryPath } = await import('./app-env')

        await expect(resolveMetadataEngineBinaryPath()).resolves.toBe(
            join(appPaths.resources, 'metadata-engine', binaryName),
        )
    })
})
