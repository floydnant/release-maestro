import { AppSettings, appSettingsSchema, storedAppSettingsSchema } from '@release-maestro/core'
import { PersistentStore } from '../utils/persistent-store.util'
import { createMainLogger } from '../logging/logger'

const log = createMainLogger('settings')

export class SettingsBackendService {
    constructor(readonly store: PersistentStore<AppSettings>) {
        log.info('settings.loaded')
    }

    /** Read the store through the tolerant schema — invalid fields are dropped, never thrown. */
    getSettings(): AppSettings {
        return storedAppSettingsSchema.parse(this.store.store)
    }

    /** Replace the whole store. Throws (and leaves the store untouched) on an invalid payload. */
    setSettings(settings: AppSettings): AppSettings {
        const parsed = appSettingsSchema.parse(settings)
        this.store.store = parsed
        return parsed
    }

    /**
     * Merge a partial update onto the *latest* stored settings, validate, persist,
     * and return the authoritative result. This is the lost-update-safe way to
     * change individual fields — callers never read-modify-replace the whole store.
     */
    patchSettings(patch: Partial<AppSettings>): AppSettings {
        const current = this.getSettings()
        return this.setSettings({
            ...current,
            ...patch,
            // Grouped settings merge one level deep: a narrow patch (say, only
            // `onboardingSkipped`) must not drop its siblings the way a plain
            // top-level spread would.
            library: { ...current.library, ...patch.library },
        })
    }
}
