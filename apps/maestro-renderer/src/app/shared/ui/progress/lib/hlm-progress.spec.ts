import { Component, signal } from '@angular/core'
import { ComponentFixture, TestBed } from '@angular/core/testing'
import { HlmProgress } from './hlm-progress'
import { HlmProgressSegment } from './hlm-progress-segment'

@Component({
    imports: [HlmProgress, HlmProgressSegment],
    template: `
        <hlm-progress aria-label="Scan progress" [value]="total" [max]="max" [glow]="glow()">
            <hlm-progress-segment [value]="success" />
            <hlm-progress-segment [value]="failed" color="content.danger" />
        </hlm-progress>
    `,
})
class TestProgress {
    total = 80
    max = 200
    success = 60
    failed = 20
    glow = signal<'always' | 'hover' | 'off'>('always')
}

describe('HlmProgress segments', () => {
    let fixture: ComponentFixture<TestProgress>

    beforeEach(async () => {
        await TestBed.configureTestingModule({ imports: [TestProgress] }).compileComponents()
        fixture = TestBed.createComponent(TestProgress)
        fixture.detectChanges()
    })

    it('announces the total and sizes outcome segments against the maximum', () => {
        const progress = fixture.nativeElement.querySelector('[role="progressbar"]') as HTMLElement
        const segments = progress.querySelectorAll<HTMLElement>('[data-slot="progress-segment"]')

        expect(progress.getAttribute('aria-label')).toBe('Scan progress')
        expect(progress.getAttribute('aria-valuenow')).toBe('80')
        expect(progress.getAttribute('aria-valuemax')).toBe('200')
        expect(Array.from(segments, segment => segment.style.width)).toEqual(['30%', '10%'])
        expect(segments[0]?.style.background).not.toBe(segments[1]?.style.background)
        expect(progress.getAttribute('data-glow')).toBe('always')
        expect(progress.classList.contains('overflow-visible')).toBe(true)
    })

    it('lets a caller disable glow without changing the progress value', () => {
        fixture.componentInstance.glow.set('off')
        fixture.detectChanges()

        const progress = fixture.nativeElement.querySelector('[role="progressbar"]') as HTMLElement
        expect(progress.getAttribute('data-glow')).toBe('off')
        expect(progress.getAttribute('aria-valuenow')).toBe('80')
    })
})
