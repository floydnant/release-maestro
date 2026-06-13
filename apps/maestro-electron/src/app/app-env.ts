import { app } from 'electron'
import envPaths, { Paths } from 'env-paths'
import { stat } from 'fs/promises'
import { join } from 'path'
// App environment paths configuration

export type AppPaths = Paths & { resources: string }

const localDevPath = '.app-data.dev'
export const appPaths: AppPaths = app.isPackaged
    ? {
          ...envPaths('release-maestro', { suffix: '' }),
          resources: join(process.resourcesPath, '..'),
      }
    : {
          cache: join(process.cwd(), localDevPath, 'cache'),
          log: join(process.cwd(), localDevPath, 'log'),
          temp: join(process.cwd(), localDevPath, 'temp'),
          data: join(process.cwd(), localDevPath, 'data'),
          config: join(process.cwd(), localDevPath, 'config'),
          resources: process.cwd(),
      }

const metadataEngineBinaryName = process.platform == 'win32' ? 'metadata-engine.exe' : 'metadata-engine'

/**
 * Resolves the `metadata-engine` Rust worker binary.
 * - Packaged: shipped alongside the app via electron-builder `extraFiles`.
 * - Dev: built by `nx build metadata-engine` (release), falling back to a debug build.
 */
export const resolveMetadataEngineBinaryPath = async (): Promise<string> => {
    if (app.isPackaged) {
        return join(appPaths.resources, 'metadata-engine', metadataEngineBinaryName)
    }

    const crateRoot = join(process.cwd(), 'apps', 'metadata-engine', 'target')
    const releaseBinary = join(crateRoot, 'release', metadataEngineBinaryName)
    const debugBinary = join(crateRoot, 'debug', metadataEngineBinaryName)
    return await stat(releaseBinary)
        .then(() => releaseBinary)
        .catch(() => debugBinary)
}

/** Directory where the engine extracts/caches embedded cover art (mirrors the Tauri cache layout). */
export const coverArtCacheDir = (): string => join(appPaths.cache, 'cover-art')
