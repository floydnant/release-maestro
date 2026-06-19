import { TestBed } from '@angular/core/testing'
import { DesignSystemComponent } from './design-system.component'

describe(DesignSystemComponent.name, () => {
    it('renders generated token specimens and reusable controls', async () => {
        await TestBed.configureTestingModule({
            imports: [DesignSystemComponent],
        }).compileComponents()

        const fixture = TestBed.createComponent(DesignSystemComponent)
        fixture.detectChanges()

        const element: HTMLElement = fixture.nativeElement
        expect(element.textContent).toContain('Foundation colors')
        expect(element.querySelectorAll('.foundation-color-column').length).toBeGreaterThan(1)
        expect(element.textContent).toContain('background.canvas')
        expect(element.textContent).toContain('Contrast pairs')
        expect(element.textContent).toContain('content.primary')
        expect(element.querySelector('.btn-primary')).toBeTruthy()
        expect(element.querySelector('.input')).toBeTruthy()
    })
})
