import Conf from 'conf'
import z from 'zod'
import { AppSettings, appSetingsSchema } from '../shared/schemas/app-settings.schema'

export class SettingsBackendService {
    store = new Conf<AppSettings>({
        configName: 'settings',
        projectName: 'mailbox-tool-app',
        projectSuffix: '',
        schema: z.toJSONSchema(appSetingsSchema).properties as any,
    })

    constructor() {
        console.log('[SettingsBackendService] initialized with:', this.store.path)
    }
}
