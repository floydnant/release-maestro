import { app } from 'electron'
import envPaths, { Paths } from 'env-paths'
import { join, resolve } from 'path'
// App environment paths configuration

export type AppPaths = Paths & { resources: string }

const localDevPath = '.app-data.dev'
const appDataOverride = process.env.RELEASE_MAESTRO_APP_DATA_DIR
    ? resolve(process.env.RELEASE_MAESTRO_APP_DATA_DIR)
    : undefined
const localDevRoot = appDataOverride ?? join(process.cwd(), localDevPath)
const resources = app.isPackaged ? join(process.resourcesPath, '..') : process.cwd()

export const appPaths: AppPaths =
    appDataOverride || !app.isPackaged
        ? {
              cache: join(localDevRoot, 'cache'),
              log: join(localDevRoot, 'log'),
              temp: join(localDevRoot, 'temp'),
              data: join(localDevRoot, 'data'),
              config: join(localDevRoot, 'config'),
              resources,
          }
        : {
              ...envPaths('release-maestro', { suffix: '' }),
              resources,
          }

const metadataEngineBinaryName = process.platform == 'win32' ? 'metadata-engine.exe' : 'metadata-engine'

/**
 * Resolves the `metadata-engine` Rust worker binary.
 * - Packaged: shipped alongside the app via electron-builder `extraFiles`.
 * - Dev: the host build produced by `nx build metadata-engine`.
 */
export const resolveMetadataEngineBinaryPath = async (): Promise<string> => {
    if (app.isPackaged) {
        return join(appPaths.resources, 'metadata-engine', metadataEngineBinaryName)
    }

    return join(
        process.cwd(),
        'apps',
        'metadata-engine',
        'target',
        'dev',
        'release',
        metadataEngineBinaryName,
    )
}

/** Directory where the engine extracts/caches embedded cover art (mirrors the Tauri cache layout). */
export const coverArtCacheDir = (): string => join(appPaths.cache, 'cover-art')
