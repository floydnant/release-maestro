import { hlm } from './hlm'

describe('Helm classes with Release Maestro tokens', () => {
    it('replaces a complete typography style without removing its text color', () => {
        expect(hlm('type-label-md text-content-primary', 'type-body-sm text-content-danger')).toBe(
            'type-body-sm text-content-danger',
        )
    })

    it('keeps semantic text color when overriding the token font size', () => {
        expect(hlm('text-content-muted text-body-sm', 'text-label-md')).toBe(
            'text-content-muted text-label-md',
        )
    })

    it('merges token shadow sizes independently from shadow colors', () => {
        expect(hlm('shadow-focus shadow-status-danger-border', 'shadow-lg')).toBe(
            'shadow-status-danger-border shadow-lg',
        )
    })

    it('lets consumers override component colors and spacing', () => {
        expect(
            hlm('bg-action-secondary text-action-secondary-content px-22 py-2', {
                'bg-action-primary text-action-primary-content px-3': true,
            }),
        ).toBe('py-2 bg-action-primary text-action-primary-content px-3')
    })
})
