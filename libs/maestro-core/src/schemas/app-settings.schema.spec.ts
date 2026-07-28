import { appSettingsSchema, storedAppSettingsSchema } from './app-settings.schema'

describe('appSettingsSchema (write validation)', () => {
    it('accepts a valid settings object and strips unknown keys', () => {
        const parsed = appSettingsSchema.parse({
            library: { folders: ['/music'], onboardingSkipped: false },
            emailPluginConfig: {},
            somethingUnknown: 42,
        })
        expect(parsed).toEqual({
            library: { folders: ['/music'], onboardingSkipped: false },
            emailPluginConfig: {},
        })
    })

    it('accepts an empty object (first-run store)', () => {
        expect(appSettingsSchema.parse({})).toEqual({ library: {}, emailPluginConfig: {} })
    })

    it('rejects invalid library fields instead of persisting them', () => {
        expect(() => appSettingsSchema.parse({ library: { folders: 'not-an-array' } })).toThrow()
        expect(() => appSettingsSchema.parse({ library: { folders: [42] } })).toThrow()
        expect(() => appSettingsSchema.parse({ library: { onboardingSkipped: 'yes' } })).toThrow()
        expect(() => appSettingsSchema.parse({ library: 'not-an-object' })).toThrow()
    })
})

describe('storedAppSettingsSchema (tolerant read)', () => {
    it('drops individually invalid fields instead of failing the read', () => {
        const parsed = storedAppSettingsSchema.parse({
            library: { folders: 'corrupted', onboardingSkipped: true },
            emailPluginConfig: 'corrupted',
        })
        expect(parsed).toEqual({
            library: { folders: undefined, onboardingSkipped: true },
            emailPluginConfig: {},
        })
    })

    it('drops a wholly corrupted library group without failing the read', () => {
        const parsed = storedAppSettingsSchema.parse({
            library: 'corrupted',
            emailPluginConfig: { APPLE_MAIL: { mailboxName: 'Releases' } },
        })
        expect(parsed.library).toEqual({})
        expect(parsed.emailPluginConfig).toEqual({ APPLE_MAIL: { mailboxName: 'Releases' } })
    })

    it('keeps valid fields intact', () => {
        const parsed = storedAppSettingsSchema.parse({
            library: { folders: ['/a', '/b'] },
            emailPluginConfig: { APPLE_MAIL: { mailboxName: 'Releases' } },
        })
        expect(parsed.library.folders).toEqual(['/a', '/b'])
        expect(parsed.emailPluginConfig).toEqual({ APPLE_MAIL: { mailboxName: 'Releases' } })
    })
})
