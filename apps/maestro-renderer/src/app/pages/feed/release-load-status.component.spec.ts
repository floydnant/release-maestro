import { TestBed } from '@angular/core/testing'
import { ReleaseLoadStatusComponent } from './release-load-status.component'

describe(ReleaseLoadStatusComponent.name, () => {
    it.each([undefined, 1])('keeps keyboard focus through a failed retry: retryAt=%s', retryAt => {
        const fixture = TestBed.createComponent(ReleaseLoadStatusComponent)
        fixture.componentRef.setInput('error', { message: 'Could not load release', retryAt })
        fixture.componentRef.setInput('releaseName', 'First release')
        fixture.componentRef.setInput('recovery', 'manual')
        fixture.detectChanges()
        const host: HTMLElement = fixture.nativeElement
        const retry = host.querySelector('button')
        if (!retry) throw new Error('Retry button was not rendered')
        const emit = jest.spyOn(fixture.componentInstance.retry, 'emit')
        retry.focus()
        retry.click()
        expect(emit).toHaveBeenCalledTimes(1)

        fixture.componentRef.setInput('recovery', 'reloading')
        fixture.detectChanges()
        expect(document.activeElement).toBe(retry)
        expect(retry.getAttribute('aria-disabled')).toBe('true')
        retry.click()
        expect(emit).toHaveBeenCalledTimes(1)

        fixture.componentRef.setInput('error', {
            message: 'Still unavailable',
            retryAt: retryAt ? undefined : 1,
        })
        fixture.componentRef.setInput('recovery', 'manual')
        fixture.detectChanges()
        expect(document.activeElement).toBe(retry)
        expect(retry.getAttribute('aria-disabled')).toBe('false')
        retry.click()
        expect(emit).toHaveBeenCalledTimes(2)
    })
})
