import { TestBed } from '@angular/core/testing'
import { HlmSpinner } from './hlm-spinner'
import { semanticColor } from '../../../design-tokens.generated'

describe(HlmSpinner.name, () => {
    it('preserves the existing loading ring at its default size', async () => {
        await TestBed.configureTestingModule({ imports: [HlmSpinner] }).compileComponents()
        const fixture = TestBed.createComponent(HlmSpinner)
        fixture.detectChanges()

        const element: HTMLElement = fixture.nativeElement
        expect(element.getAttribute('role')).toBe('status')
        expect(element.getAttribute('aria-label')).toBe('Loading')
        expect(element.style.width).toBe('22px')
        expect(element.style.height).toBe('22px')
        const circles = Array.from(element.querySelectorAll('circle'))
        expect(circles).toHaveLength(3)
        expect(circles[0]?.getAttribute('stroke')).toBe(semanticColor('border.subtle'))
        for (const circle of circles) {
            expect(circle.getAttribute('r')).toBe('6')
            expect(circle.getAttribute('stroke-width')).toBe('2.5')
            expect(circle.getAttribute('cx')).toBe('11')
            expect(circle.getAttribute('cy')).toBe('11')
        }
        for (const arc of circles.slice(1)) {
            expect(arc.getAttribute('stroke')).toBe(semanticColor('content.action'))
            expect(Number(arc.getAttribute('stroke-dashoffset'))).toBeCloseTo(9.6 * Math.PI)
        }
        expect(element.querySelector('app-icon')).toBeNull()
    })
})
