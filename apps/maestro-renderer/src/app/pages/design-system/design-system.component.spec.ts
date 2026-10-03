import { TestBed } from '@angular/core/testing'
import { DesignSystemComponent } from './design-system.component'

describe(DesignSystemComponent.name, () => {
    const originalResizeObserver = Object.getOwnPropertyDescriptor(globalThis, 'ResizeObserver')

    beforeAll(() => {
        // jsdom has no layout observer. Browser E2E covers the select's real interactions.
        const ResizeObserverMock: typeof ResizeObserver = class implements ResizeObserver {
            observe = jest.fn()
            unobserve = jest.fn()
            disconnect = jest.fn()
        }
        Object.defineProperty(globalThis, 'ResizeObserver', { configurable: true, value: ResizeObserverMock })
    })

    afterAll(() => {
        if (originalResizeObserver) {
            Object.defineProperty(globalThis, 'ResizeObserver', originalResizeObserver)
        } else {
            Reflect.deleteProperty(globalThis, 'ResizeObserver')
        }
    })

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
        const componentHeadings = Array.from(element.querySelectorAll('h2')).filter(heading =>
            heading.textContent?.includes('Components'),
        )
        expect(componentHeadings).toHaveLength(1)
        expect(componentHeadings[0]?.textContent).toBe('Components')
        expect(element.querySelector('section[aria-labelledby="components-heading"]')).toBeTruthy()
        expect(element.textContent).toContain('Preview folder import')
        expect(element.querySelector<HTMLSelectElement>('#shared-library-order')?.value).toBe('dateAdded')
        expect(element.querySelector('button[hlmBtn]')).toBeTruthy()
        expect(element.querySelector('input[hlmInput]')).toBeTruthy()
        expect(element.textContent).toContain('Hydrated')
        expect(element.textContent).toContain('Surfaces')
    })
})
