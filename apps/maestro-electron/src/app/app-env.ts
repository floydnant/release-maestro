import { app } from 'electron'
import envPaths, { Paths } from 'env-paths'
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
