import { appSettingsSchema, storedAppSettingsSchema } from './app-settings.schema'

describe('appSettingsSchema (write validation)', () => {
    it('accepts a valid settings object and strips unknown keys', () => {
        const parsed = appSettingsSchema.parse({
            libraryFolders: ['/music'],
            libraryOnboardingSkipped: false,
            emailPluginConfig: {},
            somethingUnknown: 42,
        })
        expect(parsed).toEqual({
            libraryFolders: ['/music'],
            libraryOnboardingSkipped: false,
            emailPluginConfig: {},
        })
    })

    it('accepts an empty object (first-run store)', () => {
        expect(appSettingsSchema.parse({})).toEqual({ emailPluginConfig: {} })
    })

    it('rejects invalid library fields instead of persisting them', () => {
        expect(() => appSettingsSchema.parse({ libraryFolders: 'not-an-array' })).toThrow()
        expect(() => appSettingsSchema.parse({ libraryFolders: [42] })).toThrow()
        expect(() => appSettingsSchema.parse({ libraryOnboardingSkipped: 'yes' })).toThrow()
    })
})

describe('storedAppSettingsSchema (tolerant read)', () => {
    it('drops individually invalid fields instead of failing the read', () => {
        const parsed = storedAppSettingsSchema.parse({
            libraryFolders: 'corrupted',
            libraryOnboardingSkipped: true,
            emailPluginConfig: 'corrupted',
        })
        expect(parsed).toEqual({
            libraryFolders: undefined,
            libraryOnboardingSkipped: true,
            emailPluginConfig: {},
        })
    })

    it('keeps valid fields intact', () => {
        const parsed = storedAppSettingsSchema.parse({
            libraryFolders: ['/a', '/b'],
            emailPluginConfig: { APPLE_MAIL: { mailboxName: 'Releases' } },
        })
        expect(parsed.libraryFolders).toEqual(['/a', '/b'])
        expect(parsed.emailPluginConfig).toEqual({ APPLE_MAIL: { mailboxName: 'Releases' } })
    })
})
