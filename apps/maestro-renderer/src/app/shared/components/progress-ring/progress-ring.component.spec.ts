import { ComponentFixture, TestBed } from '@angular/core/testing'
import { ProgressRingComponent } from './progress-ring.component'
import { semanticColor } from '../../design-tokens.generated'

describe('ProgressRingComponent', () => {
    let fixture: ComponentFixture<ProgressRingComponent>

    beforeEach(async () => {
        await TestBed.configureTestingModule({
            imports: [ProgressRingComponent],
        }).compileComponents()

        fixture = TestBed.createComponent(ProgressRingComponent)
        fixture.detectChanges()
    })

    it('keeps circular geometry and exposes determinate progress through Brain', () => {
        fixture.componentRef.setInput('diameter', 25)
        fixture.componentRef.setInput('strokeWidth', 2.5)
        fixture.componentRef.setInput('progress', 75)
        fixture.detectChanges()

        const element: HTMLElement = fixture.nativeElement
        const meter = element.querySelector<SVGElement>('[role="progressbar"]')
        expect(meter?.getAttribute('aria-valuenow')).toBe('75')
        expect(meter?.style.width).toBe('25px')
        expect(meter?.style.height).toBe('25px')
        expect(meter?.querySelector('.progress-ring')?.getAttribute('r')).toBe('7.5')
        expect(Number(meter?.querySelector('.progress-ring')?.getAttribute('stroke-dashoffset'))).toBeCloseTo(
            3.75 * Math.PI,
        )
    })

    it('keeps the original two arcs, geometry and colors for indeterminate work', () => {
        fixture.componentRef.setInput('mode', 'spinning')
        fixture.componentRef.setInput('diameter', 18)
        fixture.componentRef.setInput('strokeWidth', 2)
        fixture.componentRef.setInput('color', 'content.success')
        fixture.componentRef.setInput('bgColor', 'transparent')
        fixture.componentRef.setInput('aria-label', 'Loading releases')
        fixture.detectChanges()

        const element: HTMLElement = fixture.nativeElement
        const spinner = element.querySelector<HTMLElement>('hlm-spinner')
        expect(element.querySelector('[role="progressbar"]')).toBeNull()
        expect(spinner?.getAttribute('role')).toBe('status')
        expect(spinner?.getAttribute('aria-label')).toBe('Loading releases')
        expect(spinner?.style.width).toBe('18px')
        expect(spinner?.style.height).toBe('18px')
        const svg = spinner?.querySelector('svg')
        expect(svg?.getAttribute('width')).toBe('18')
        expect(svg?.getAttribute('height')).toBe('18')
        expect(svg?.getAttribute('aria-hidden')).toBe('true')
        const circles = Array.from(svg?.querySelectorAll('circle') ?? [])
        expect(circles).toHaveLength(3)
        expect(circles[0]?.getAttribute('stroke')).toBe('transparent')
        for (const circle of circles) {
            expect(circle.getAttribute('stroke-width')).toBe('2')
            expect(circle.getAttribute('r')).toBe('5')
            expect(circle.getAttribute('cx')).toBe('9')
            expect(circle.getAttribute('cy')).toBe('9')
        }
        for (const arc of circles.slice(1)) {
            expect(arc.getAttribute('stroke')).toBe(semanticColor('content.success'))
            expect(arc.getAttribute('stroke-dasharray')).toBe(`${10 * Math.PI} ${10 * Math.PI}`)
            expect(Number(arc.getAttribute('stroke-dashoffset'))).toBeCloseTo(8 * Math.PI)
        }
        expect(spinner?.querySelector('app-icon')).toBeNull()
    })
})
