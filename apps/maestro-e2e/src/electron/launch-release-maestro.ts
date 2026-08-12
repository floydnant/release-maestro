import { access } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { _electron as electron, ElectronApplication } from 'playwright'

export const workspaceRoot = join(__dirname, '../../../..')

const electronMainPath = join(workspaceRoot, 'dist/apps/maestro-electron/main.js')

/** Resolve electron-builder's unpacked executable for the host OS and architecture. */
export const resolvePackagedExecutablePath = (
    platform: NodeJS.Platform = process.platform,
    architecture: string = process.arch,
): string => {
    const builderArchitecture = architecture === 'arm' ? 'armv7l' : architecture
    if (!['x64', 'ia32', 'arm64', 'armv7l'].includes(builderArchitecture)) {
        throw new Error(`Unsupported packaged-app architecture: ${architecture}`)
    }

    const architectureSuffix = builderArchitecture === 'x64' ? '' : `-${builderArchitecture}`
    const outputRoot = join(workspaceRoot, 'dist/packages')

    switch (platform) {
        case 'darwin':
            return join(
                outputRoot,
                `mac${architectureSuffix}`,
                'Release Maestro.app',
                'Contents',
                'MacOS',
                'Release Maestro',
            )
        case 'win32':
            return join(outputRoot, `win${architectureSuffix}-unpacked`, 'Release Maestro.exe')
        case 'linux':
            return join(outputRoot, `linux${architectureSuffix}-unpacked`, 'release-maestro')
        default:
            throw new Error(`Unsupported packaged-app platform: ${platform}`)
    }
}

const cleanEnv = (): Record<string, string> => {
    const env = Object.fromEntries(
        Object.entries(process.env).filter((entry): entry is [string, string] => typeof entry[1] == 'string'),
    )
    delete env.ELECTRON_RUN_AS_NODE
    delete env.ELECTRON_IS_DEV
    return env
}

/** Launch the compiled development app, or the packaged app under the production Playwright config. */
export const launchReleaseMaestro = async (appDataDir: string): Promise<ElectronApplication> => {
    const packaged = process.env['MAESTRO_E2E_PACKAGED'] === '1'
    const configuredExecutablePath = process.env['MAESTRO_E2E_EXECUTABLE_PATH']
    const executablePath = configuredExecutablePath
        ? resolve(workspaceRoot, configuredExecutablePath)
        : resolvePackagedExecutablePath()

    if (packaged) {
        await access(executablePath).catch(() => {
            throw new Error(
                `Packaged executable not found for ${process.platform}/${process.arch}: ${executablePath}. Run make package-dir first.`,
            )
        })
    }

    return electron.launch({
        ...(packaged ? { executablePath } : { args: [electronMainPath] }),
        cwd: workspaceRoot,
        env: {
            ...cleanEnv(),
            ...(packaged ? {} : { ELECTRON_IS_DEV: '1' }),
            RELEASE_MAESTRO_APP_DATA_DIR: appDataDir,
            RELEASE_MAESTRO_E2E_BACKGROUND: process.env['RELEASE_MAESTRO_E2E_BACKGROUND'] ?? '1',
        },
    })
}
