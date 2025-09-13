import Conf from 'conf'
import z from 'zod'
import { AppSettings, appSettingsSchema } from '../shared/schemas/app-settings.schema'
import { appPaths } from './app-env'

export class SettingsBackendService {
    store = new Conf<AppSettings>({
        cwd: appPaths.config,
        configName: 'settings',
        schema: z.toJSONSchema(appSettingsSchema).properties as any,
    })

    constructor() {
        console.log('[SettingsBackendService] initialized with:', this.store.path, this.store.store)
    }
}
