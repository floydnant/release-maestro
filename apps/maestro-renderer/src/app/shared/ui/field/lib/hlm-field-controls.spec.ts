import { ChangeDetectionStrategy, Component, signal } from '@angular/core'
import { TestBed } from '@angular/core/testing'
import { HlmField, HlmFieldDescription, HlmFieldError, HlmFieldLabel } from '@spartan-ng/helm/field'
import { HlmInput } from '@spartan-ng/helm/input'
import { HlmTextarea } from '@spartan-ng/helm/textarea'

@Component({
    selector: 'hlm-field-controls-test',
    imports: [HlmInput, HlmTextarea, HlmFieldLabel],
    changeDetection: ChangeDetectionStrategy.OnPush,
    template: `
        <p id="manual-hint">Use the release title.</p>
        <label hlmFieldLabel id="title-label" [for]="'title-control'">Title</label>
        <input hlmInput id="title-control" aria-label="Title" aria-describedby="manual-hint" />
        <textarea hlmTextarea aria-label="Notes" aria-describedby="manual-hint"></textarea>
    `,
})
class FieldControlsTest {}

@Component({
    selector: 'hlm-forced-error-test',
    imports: [HlmField, HlmInput, HlmFieldDescription, HlmFieldError],
    changeDetection: ChangeDetectionStrategy.OnPush,
    template: `
        <div hlmField>
            <input hlmInput aria-label="Title" />
            <p hlmFieldDescription id="field-hint">Use the release title.</p>
            @if (showError()) {
                <hlm-field-error [id]="errorId()" [forceShow]="forceShow()">Could not save.</hlm-field-error>
            }
        </div>
    `,
})
class ForcedErrorTest {
    readonly forceShow = signal(true)
    readonly errorId = signal('save-error')
    readonly showError = signal(true)
}

describe('Helm field controls', () => {
    it('associates a visible forced error with its control and removes stale associations', async () => {
        const fixture = TestBed.createComponent(ForcedErrorTest)
        fixture.detectChanges()
        await fixture.whenStable()

        const control: HTMLInputElement = fixture.nativeElement.querySelector('input')
        const error: HTMLElement = fixture.nativeElement.querySelector('hlm-field-error')
        expect(error.hidden).toBe(false)
        expect(control.getAttribute('aria-describedby')).toBe('field-hint save-error')

        fixture.componentInstance.forceShow.set(false)
        fixture.detectChanges()
        await fixture.whenStable()
        expect(error.hidden).toBe(true)
        expect(control.getAttribute('aria-describedby')).toBe('field-hint')

        fixture.componentInstance.forceShow.set(true)
        fixture.componentInstance.errorId.set('retry-error')
        fixture.detectChanges()
        await fixture.whenStable()
        expect(control.getAttribute('aria-describedby')).toBe('field-hint retry-error')

        fixture.componentInstance.showError.set(false)
        fixture.detectChanges()
        await fixture.whenStable()
        expect(control.getAttribute('aria-describedby')).toBe('field-hint')
    })

    it('keeps the caller label target and id outside a Field', () => {
        const fixture = TestBed.createComponent(FieldControlsTest)
        fixture.detectChanges()

        const label: HTMLElement = fixture.nativeElement.querySelector('label')
        expect(label.getAttribute('for')).toBe('title-control')
        expect(label.id).toBe('title-label')
    })

    it('preserves caller descriptions on native inputs and textareas', () => {
        const fixture = TestBed.createComponent(FieldControlsTest)
        fixture.detectChanges()

        const controls: NodeListOf<HTMLElement> = fixture.nativeElement.querySelectorAll('input, textarea')
        expect(controls).toHaveLength(2)
        for (const control of controls) {
            expect(control.getAttribute('aria-describedby')).toBe('manual-hint')
        }
    })
})
