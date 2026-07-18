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
            libraryFolders: ['/music'],
            emailPluginConfig: { APPLE_MAIL: { mailboxName: 'Releases' } },
        })

        const patched = service.patchSettings({ libraryOnboardingSkipped: true })

        expect(patched.libraryFolders).toEqual(['/music'])
        expect(patched.emailPluginConfig).toEqual({ APPLE_MAIL: { mailboxName: 'Releases' } })
        expect(patched.libraryOnboardingSkipped).toBe(true)
        // And the patch is what actually got persisted.
        expect(service.getSettings()).toEqual(patched)
    })

    it('patches merge onto the latest stored state, not a stale caller copy', () => {
        service.setSettings({ libraryFolders: ['/old'], emailPluginConfig: {} })
        // Another writer updates the store between a caller's read and its patch.
        service.patchSettings({ libraryFolders: ['/new'] })

        const result = service.patchSettings({ libraryOnboardingSkipped: true })

        expect(result.libraryFolders).toEqual(['/new'])
        expect(result.libraryOnboardingSkipped).toBe(true)
    })

    it('rejects invalid payloads without touching the store', () => {
        service.setSettings({ libraryFolders: ['/music'], emailPluginConfig: {} })

        expect(() => service.patchSettings({ libraryFolders: 'nope' as unknown as string[] })).toThrow()
        expect(() =>
            service.setSettings({ libraryFolders: [42] } as unknown as AppSettings),
        ).toThrow()

        expect(service.getSettings().libraryFolders).toEqual(['/music'])
    })

    it('reads a store with individually corrupted fields without throwing', () => {
        store.store = {
            libraryFolders: 'corrupted',
            libraryOnboardingSkipped: true,
        } as unknown as AppSettings

        const settings = service.getSettings()

        expect(settings.libraryFolders).toBeUndefined()
        expect(settings.libraryOnboardingSkipped).toBe(true)
    })
})
