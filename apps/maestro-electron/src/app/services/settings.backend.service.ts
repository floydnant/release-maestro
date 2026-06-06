import Conf from 'conf'
import { AppSettings } from '@release-maestro/core'
import { appPaths } from '../app-env'

export class SettingsBackendService {
    store = new Conf<AppSettings>({
        cwd: appPaths.config,
        configName: 'settings',
        // schema: Add schema validation as needed
    })

    constructor() {
        console.log('[SettingsBackendService] initialized with:', this.store.path, this.store.store)
    }
}
