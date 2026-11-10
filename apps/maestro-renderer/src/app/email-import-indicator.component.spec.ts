import { TestBed } from '@angular/core/testing'
import { EmailImportProgressUpdate } from '@release-maestro/core'
import { EmailImportIndicatorComponent } from './email-import-indicator.component'

describe(EmailImportIndicatorComponent.name, () => {
    beforeEach(() => {
        jest.useFakeTimers({ doNotFake: ['queueMicrotask', 'nextTick'] })
    })
    afterEach(() => {
        jest.useRealTimers()
    })

    const render = () => {
        const fixture = TestBed.createComponent(EmailImportIndicatorComponent)
        const element: HTMLElement = fixture.nativeElement
        const cancelled: MouseEvent[] = []
        fixture.componentInstance.cancelImport.subscribe(event => cancelled.push(event))
        const emit = (update: EmailImportProgressUpdate | null) => {
            fixture.componentRef.setInput('update', update)
            fixture.detectChanges()
        }
        emit(null)
        return {
            emit,
            /** Lets paced phases advance. */
            advance: (ms: number) => {
                jest.advanceTimersByTime(ms)
                fixture.detectChanges()
            },
            cancelled,
            text: () =>
                element.querySelector('.email-import-indicator')?.textContent?.replace(/\s+/g, ' ').trim() ??
                null,
            ring: () => element.querySelector<SVGElement>('.email-import-indicator [role="progressbar"]'),
            spinner: () => element.querySelector('.email-import-indicator hlm-spinner'),
            cancel: () => element.querySelector<HTMLButtonElement>('.email-import-cancel'),
        }
    }

    const finishing = (current: number, total: number, trigger: 'auto' | 'manual' = 'auto') =>
        ({ phase: 'finishing', current, total, trigger }) as const

    it('counts processed emails from where they stood when the export ended', () => {
        const { emit, advance, text, ring, spinner } = render()
        emit({ phase: 'processing', current: 40, total: 40, message: 'Importing', trigger: 'auto' })
        expect(text()).toBe('Importing emails 40/40')
        expect(ring()?.getAttribute('aria-valuenow')).toBe('100')

        emit(finishing(30, 40))
        // The export's full ring dwells for its second before the count takes over
        expect(text()).toBe('Importing emails 40/40')
        advance(1000)

        expect(text()).toBe('Processing emails 30/40')
        expect(spinner()).toBeNull()
        expect(ring()?.getAttribute('aria-label')).toBe('Processing emails')
        expect(ring()?.getAttribute('aria-valuenow')).toBe('75')

        emit(finishing(36, 40))
        expect(text()).toBe('Processing emails 36/40')
        expect(ring()?.getAttribute('aria-valuenow')).toBe('90')
    })

    it('shows the latest count once the export phase has dwelled', () => {
        const { emit, advance, text } = render()
        emit({ phase: 'processing', current: 5, total: 8, message: 'Importing', trigger: 'auto' })
        emit(finishing(6, 8))
        emit(finishing(7, 8))

        advance(1000)

        expect(text()).toBe('Processing emails 7/8')
    })

    it('shows a manual import without pacing', () => {
        const { emit, text } = render()
        emit({ phase: 'processing', current: 8, total: 8, message: 'Importing', trigger: 'manual' })
        emit(finishing(2, 8, 'manual'))

        expect(text()).toBe('Processing emails 2/8')
    })

    it('keeps counting when a manual request takes the import over', () => {
        const { emit, text, cancel } = render()
        emit(finishing(3, 8))
        expect(text()).toBe('Processing emails 3/8')

        emit(finishing(5, 8, 'manual'))

        expect(text()).toBe('Processing emails 5/8')
        expect(cancel()).not.toBeNull()
    })

    it('stays cancellable while emails are processed, until the cancel is reported', () => {
        const { emit, advance, text, cancel, cancelled } = render()
        emit(finishing(3, 8))

        cancel()?.click()
        expect(cancelled).toHaveLength(1)
        expect(text()).toBe('Processing emails 3/8')

        emit({ phase: 'cancelled', trigger: 'auto' })
        expect(cancel()).toBeNull()
        advance(1000)
        expect(text()).toBeNull()
    })
})
