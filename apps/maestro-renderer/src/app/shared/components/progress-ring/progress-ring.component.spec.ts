import { ComponentFixture, TestBed } from '@angular/core/testing'
import { ProgressRingComponent } from './progress-ring.component'

describe('ProgressRingComponent', () => {
    let component: ProgressRingComponent
    let fixture: ComponentFixture<ProgressRingComponent>

    beforeEach(async () => {
        await TestBed.configureTestingModule({
            imports: [ProgressRingComponent],
        }).compileComponents()

        fixture = TestBed.createComponent(ProgressRingComponent)
        component = fixture.componentInstance
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

    it('switches to the shared spinner at the requested size for indeterminate work', () => {
        fixture.componentRef.setInput('mode', 'spinning')
        fixture.componentRef.setInput('diameter', 18)
        fixture.detectChanges()

        const element: HTMLElement = fixture.nativeElement
        const spinner = element.querySelector<HTMLElement>('hlm-spinner')
        expect(element.querySelector('[role="progressbar"]')).toBeNull()
        expect(spinner?.getAttribute('role')).toBe('status')
        expect(spinner?.style.width).toBe('18px')
        expect(spinner?.style.height).toBe('18px')
        expect(spinner?.querySelector('svg')).toBeTruthy()
    })
})
