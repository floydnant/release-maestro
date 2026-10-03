import { ChangeDetectionStrategy, Component, signal } from '@angular/core'
import { TestBed } from '@angular/core/testing'
import { HlmButton } from './hlm-button'

@Component({
    selector: 'hlm-button-focus-test',
    imports: [HlmButton],
    changeDetection: ChangeDetectionStrategy.OnPush,
    template: `
        <button hlmBtn id="bound-tabindex" [tabindex]="tabindex()" [disabled]="disabled()">
            Grid action
        </button>
        <button hlmBtn id="static-tabindex" tabindex="-1" [disabled]="disabled()">Static tabindex</button>
    `,
})
class ButtonFocusTest {
    readonly disabled = signal(false)
    readonly tabindex = signal(-1)
}

describe('HlmButton', () => {
    it('preserves a consumer-bound grid tabindex while enabled and disabled', () => {
        const fixture = TestBed.createComponent(ButtonFocusTest)
        fixture.detectChanges()
        const bound: HTMLButtonElement = fixture.nativeElement.querySelector('#bound-tabindex')
        const staticTabindex: HTMLButtonElement = fixture.nativeElement.querySelector('#static-tabindex')

        expect(bound.tabIndex).toBe(-1)
        expect(staticTabindex.tabIndex).toBe(-1)
        fixture.componentInstance.disabled.set(true)
        fixture.detectChanges()
        expect(bound.disabled).toBe(true)
        expect(bound.tabIndex).toBe(-1)
        expect(staticTabindex.tabIndex).toBe(-1)
        fixture.componentInstance.disabled.set(false)
        fixture.detectChanges()
        expect(bound.disabled).toBe(false)
        expect(bound.tabIndex).toBe(-1)
        expect(staticTabindex.tabIndex).toBe(-1)
        fixture.componentInstance.tabindex.set(2)
        fixture.detectChanges()
        expect(bound.tabIndex).toBe(2)
        expect(staticTabindex.tabIndex).toBe(-1)
    })
})
