import { appRoutes } from './app.routes'

describe('appRoutes', () => {
    it('includes the design-system specimen in development', () => {
        expect(appRoutes.some(route => route.path === 'design-system')).toBe(true)
    })
})
