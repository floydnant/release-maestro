import { parseEnvironmentPort } from '@release-maestro/core'
import { environment } from '../environments/environment'

export const rendererAppPort = environment.production
    ? 4200
    : parseEnvironmentPort(
          'RELEASE_MAESTRO_RENDERER_PORT',
          process.env['RELEASE_MAESTRO_RENDERER_PORT'],
          4200,
      )
export const developmentAppName = process.env['RELEASE_MAESTRO_DEV_APP_NAME']?.trim() || null
export const rendererAppName = 'maestro-renderer' // options.name.split('-')[0] + '-web'
export const electronAppName = 'maestro-electron'

// TODO: figure out how updates will be hosted
export const updateServerUrl = 'https://deployment-server-url.com'
