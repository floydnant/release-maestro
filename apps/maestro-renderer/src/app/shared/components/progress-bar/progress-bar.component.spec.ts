import { ComponentFixture, TestBed } from '@angular/core/testing'
import { ProgressBarComponent } from './progress-bar.component'

describe('ProgressBarComponent', () => {
    let component: ProgressBarComponent
    let fixture: ComponentFixture<ProgressBarComponent>

    beforeEach(async () => {
        await TestBed.configureTestingModule({
            imports: [ProgressBarComponent],
            providers: [],
        }).compileComponents()

        fixture = TestBed.createComponent(ProgressBarComponent)
        fixture.componentRef.setInput('segments', [])
        component = fixture.componentInstance
        fixture.detectChanges()
    })

    it('announces combined progress while preserving each outcome segment', () => {
        fixture.componentRef.setInput('segments', [
            { percent: 30, color: 'content.success' },
            { percent: 10, color: 'content.danger' },
        ])
        fixture.componentRef.setInput('shouldGlow', false)
        fixture.detectChanges()

        const element: HTMLElement = fixture.nativeElement
        const meter = element.querySelector('[role="progressbar"]')
        expect(meter?.getAttribute('aria-valuenow')).toBe('40')
        expect(meter?.getAttribute('aria-valuemax')).toBe('100')
        expect(meter?.getAttribute('aria-label')).toBe('Library scan progress')
        expect(meter?.classList.contains('glow')).toBe(false)
        const segments = element.querySelectorAll<HTMLElement>('.progress-segment')
        expect(Array.from(segments, segment => segment.style.width)).toEqual(['30%', '10%'])
        expect(segments[0]?.style.background).not.toBe(segments[1]?.style.background)
    })
})
