import { ChangeDetectionStrategy, Component, signal, viewChild } from '@angular/core'
import { TestBed } from '@angular/core/testing'
import { FormsModule } from '@angular/forms'
import { HlmSwitch } from './hlm-switch'

@Component({
    selector: 'hlm-switch-test',
    imports: [HlmSwitch, FormsModule],
    changeDetection: ChangeDetectionStrategy.OnPush,
    template: `
        <label for="hide-unplayable">Hide unplayable releases</label>
        <p id="hide-unplayable-description">Releases return once a track can be previewed.</p>
        <hlm-switch
            inputId="hide-unplayable"
            aria-describedby="hide-unplayable-description"
            [(checked)]="checked"
            [disabled]="disabled()"
        />
        <hlm-switch aria-label="Bound through forms" [(ngModel)]="formValue" />
    `,
})
class SwitchTest {
    readonly switch = viewChild.required(HlmSwitch)
    readonly checked = signal(true)
    readonly disabled = signal(false)
    formValue = false
}

describe(HlmSwitch.name, () => {
    const render = async () => {
        const fixture = TestBed.createComponent(SwitchTest)
        fixture.autoDetectChanges()
        await fixture.whenStable()
        const [button, formButton] = Array.from<HTMLButtonElement>(
            fixture.nativeElement.querySelectorAll('button[role="switch"]'),
        )
        return { fixture, button, formButton }
    }

    it('names the switch button from its label and keeps the caller description', async () => {
        const { fixture, button } = await render()

        const label: HTMLLabelElement = fixture.nativeElement.querySelector('label')
        expect(button.id).toBe('hide-unplayable')
        expect(button.getAttribute('aria-labelledby')).toBe(label.id)
        expect(button.getAttribute('aria-describedby')).toBe('hide-unplayable-description')
        expect(fixture.nativeElement.querySelector('hlm-switch').hasAttribute('aria-describedby')).toBe(false)
    })

    it('toggles the bound state and reports it to assistive technology', async () => {
        const { fixture, button } = await render()
        expect(button.getAttribute('aria-checked')).toBe('true')

        button.click()
        await fixture.whenStable()

        expect(fixture.componentInstance.checked()).toBe(false)
        expect(button.getAttribute('aria-checked')).toBe('false')
        expect(button.getAttribute('data-state')).toBe('unchecked')
    })

    it('follows state set by its owner', async () => {
        const { fixture, button } = await render()

        fixture.componentInstance.checked.set(false)
        await fixture.whenStable()

        expect(button.getAttribute('aria-checked')).toBe('false')
    })

    it('ignores activation while disabled', async () => {
        const { fixture, button } = await render()
        fixture.componentInstance.disabled.set(true)
        await fixture.whenStable()

        expect(button.disabled).toBe(true)
        button.click()
        await fixture.whenStable()

        expect(fixture.componentInstance.checked()).toBe(true)
    })

    it('moves focus to the switch button', async () => {
        const { fixture, button } = await render()

        fixture.componentInstance.switch().focus()

        expect(document.activeElement).toBe(button)
    })

    it('works as a forms control', async () => {
        const { fixture, formButton } = await render()

        formButton.click()
        await fixture.whenStable()

        expect(fixture.componentInstance.formValue).toBe(true)
        expect(formButton.getAttribute('aria-label')).toBe('Bound through forms')
    })
})
