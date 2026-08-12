import { appRoutes } from './app.routes'

describe('appRoutes', () => {
    it('includes the design-system specimen in development', () => {
        expect(appRoutes.some(route => route.path === 'design-system')).toBe(true)
    })

    it('includes debug settings in development', () => {
        const settings = appRoutes.find(route => route.path === 'settings')

        expect(settings?.children?.some(route => route.path === 'debug')).toBe(true)
    })
})
