import { OverlayContainer } from '@angular/cdk/overlay'
import { ChangeDetectionStrategy, Component, TemplateRef, viewChild } from '@angular/core'
import { TestBed } from '@angular/core/testing'
import { HlmDialogService } from './hlm-dialog.service'

@Component({
    selector: 'hlm-dialog-service-test',
    changeDetection: ChangeDetectionStrategy.OnPush,
    template: `
        <ng-template #content let-dialog>
            <p>{{ dialog.message }}</p>
            <button (click)="dialog.close('confirmed')">Confirm</button>
        </ng-template>
    `,
})
class DialogServiceTest {
    readonly content = viewChild.required<TemplateRef<unknown>>('content')
}

describe('HlmDialogService', () => {
    it('renders a template with its context and lets it close with a result', () => {
        const fixture = TestBed.createComponent(DialogServiceTest)
        fixture.detectChanges()
        const overlay = TestBed.inject(OverlayContainer).getContainerElement()
        const ref = TestBed.inject(HlmDialogService).open<string>(fixture.componentInstance.content(), {
            context: { message: 'Confirm album import' },
            showCloseButton: false,
        })
        fixture.detectChanges()

        expect(overlay.textContent).toContain('Confirm album import')
        const close = jest.spyOn(ref, 'close')
        overlay.querySelector<HTMLButtonElement>('button')?.click()
        expect(close).toHaveBeenCalledWith('confirmed')
        expect(ref.phase()).toBe('closing')
        ref.forceClose()
    })
})
