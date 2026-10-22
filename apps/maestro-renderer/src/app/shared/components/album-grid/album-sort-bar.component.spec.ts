import { TestBed } from '@angular/core/testing'
import { AlbumSortField } from '@release-maestro/core'
import { AlbumSortBarComponent } from './album-sort-bar.component'

describe('AlbumSortBarComponent', () => {
    // jsdom lacks the layout APIs the select's overlay measures with.
    beforeAll(() => {
        globalThis.ResizeObserver ??= class {
            observe = () => undefined
            unobserve = () => undefined
            disconnect = () => undefined
        }
        Element.prototype.scrollIntoView ??= () => undefined
    })

    const render = (field: AlbumSortField) => {
        const fixture = TestBed.createComponent(AlbumSortBarComponent)
        fixture.componentRef.setInput('sort', { field, direction: 'asc' })
        fixture.detectChanges()
        return fixture
    }

    const shownValue = (element: HTMLElement) =>
        element.querySelector('[data-slot="select-value"]')?.textContent?.trim()

    it('shows the sort restored from the URL by its label, and follows later changes', () => {
        const fixture = render(AlbumSortField.year)
        const trigger: HTMLButtonElement = fixture.nativeElement.querySelector('#album-sort-field')

        expect(trigger.getAttribute('role')).toBe('combobox')
        expect(trigger.labels?.[0]?.textContent).toContain('Sort by')
        expect(shownValue(fixture.nativeElement)).toBe('Year')

        fixture.componentRef.setInput('sort', { field: AlbumSortField.title, direction: 'desc' })
        fixture.detectChanges()
        expect(shownValue(fixture.nativeElement)).toBe('Title')
    })

    it('emits the domain sort field the user picks', async () => {
        const fixture = render(AlbumSortField.year)
        const changed = jest.fn()
        fixture.componentInstance.sortField.subscribe(changed)

        fixture.nativeElement.querySelector('#album-sort-field').click()
        fixture.detectChanges()
        await fixture.whenStable()

        const option = Array.from(document.querySelectorAll<HTMLElement>('[role="option"]')).find(
            element => element.textContent?.trim() === 'Album artist',
        )
        option?.click()
        fixture.detectChanges()

        expect(changed).toHaveBeenCalledWith(AlbumSortField.albumArtist)
    })
})
