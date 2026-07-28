import { AppSettings } from '@release-maestro/core'
import { InMemoryStore } from '../utils/persistent-store.util'
import { SettingsBackendService } from './settings.backend.service'

describe('SettingsBackendService', () => {
    let store: InMemoryStore<AppSettings>
    let service: SettingsBackendService

    beforeEach(() => {
        store = new InMemoryStore<AppSettings>()
        service = new SettingsBackendService(store)
    })

    it('patches preserve unrelated fields', () => {
        service.setSettings({
            library: { folders: ['/music'] },
            emailPluginConfig: { APPLE_MAIL: { mailboxName: 'Releases' } },
        })

        const patched = service.patchSettings({ library: { onboardingSkipped: true } })

        expect(patched.library.folders).toEqual(['/music'])
        expect(patched.emailPluginConfig).toEqual({ APPLE_MAIL: { mailboxName: 'Releases' } })
        expect(patched.library.onboardingSkipped).toBe(true)
        // And the patch is what actually got persisted.
        expect(service.getSettings()).toEqual(patched)
    })

    it('patches merge into a settings group instead of replacing it', () => {
        service.setSettings({ library: { folders: ['/music'] }, emailPluginConfig: {} })

        // A patch naming only one key of `library` must not drop its siblings.
        const patched = service.patchSettings({ library: { onboardingSkipped: true } })

        expect(patched.library).toEqual({ folders: ['/music'], onboardingSkipped: true })
    })

    it('patches merge onto the latest stored state, not a stale caller copy', () => {
        service.setSettings({ library: { folders: ['/old'] }, emailPluginConfig: {} })
        // Another writer updates the store between a caller's read and its patch.
        service.patchSettings({ library: { folders: ['/new'] } })

        const result = service.patchSettings({ library: { onboardingSkipped: true } })

        expect(result.library.folders).toEqual(['/new'])
        expect(result.library.onboardingSkipped).toBe(true)
    })

    it('rejects invalid payloads without touching the store', () => {
        service.setSettings({ library: { folders: ['/music'] }, emailPluginConfig: {} })

        expect(() => service.patchSettings({ library: { folders: 'nope' as unknown as string[] } })).toThrow()
        expect(() => service.setSettings({ library: { folders: [42] } } as unknown as AppSettings)).toThrow()

        expect(service.getSettings().library.folders).toEqual(['/music'])
    })

    it('reads a store with individually corrupted fields without throwing', () => {
        store.store = {
            library: { folders: 'corrupted', onboardingSkipped: true },
        } as unknown as AppSettings

        const settings = service.getSettings()

        expect(settings.library.folders).toBeUndefined()
        expect(settings.library.onboardingSkipped).toBe(true)
    })

    it('reads a store whose whole library group is corrupted without throwing', () => {
        store.store = { library: 'corrupted' } as unknown as AppSettings

        expect(service.getSettings().library).toEqual({})
    })
})
