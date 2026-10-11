import { ChangeDetectionStrategy, Component } from '@angular/core'
import { TestBed } from '@angular/core/testing'
import { HlmFieldLabel } from '@spartan-ng/helm/field'
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

describe('Helm field controls', () => {
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
