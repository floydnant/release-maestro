import { appRoutes } from './app.routes'

describe('appRoutes', () => {
    it('nests the design-system specimen under settings in development', () => {
        const settings = appRoutes.find(route => route.path === 'settings')

        expect(settings?.children?.some(route => route.path === 'design-system')).toBe(true)
        expect(appRoutes.some(route => route.path === 'design-system')).toBe(false)
    })

    it('includes debug settings in development', () => {
        const settings = appRoutes.find(route => route.path === 'settings')

        expect(settings?.children?.some(route => route.path === 'debug')).toBe(true)
    })
})
