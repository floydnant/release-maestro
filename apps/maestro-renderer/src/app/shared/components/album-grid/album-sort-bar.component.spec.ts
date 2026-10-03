import { TestBed } from '@angular/core/testing'
import { AlbumSortField } from '@release-maestro/core'
import { AlbumSortBarComponent } from './album-sort-bar.component'

describe('AlbumSortBarComponent', () => {
    it('emits the selected domain sort field through the native select', () => {
        const fixture = TestBed.createComponent(AlbumSortBarComponent)
        fixture.componentRef.setInput('sort', { field: AlbumSortField.year, direction: 'asc' })
        fixture.detectChanges()
        const changed = jest.fn()
        fixture.componentInstance.sortField.subscribe(changed)

        const select: HTMLSelectElement = fixture.nativeElement.querySelector('select')
        select.value = AlbumSortField.albumArtist
        select.dispatchEvent(new Event('change'))
        expect(changed).toHaveBeenCalledWith(AlbumSortField.albumArtist)
    })

    it('shows the nondefault sort field after its projected options render', () => {
        const fixture = TestBed.createComponent(AlbumSortBarComponent)
        fixture.componentRef.setInput('sort', { field: AlbumSortField.year, direction: 'asc' })
        fixture.detectChanges()

        const select: HTMLSelectElement = fixture.nativeElement.querySelector('select')
        expect(select.id).toBe('album-sort-field')
        expect(select.value).toBe(AlbumSortField.year)
        expect(select.labels?.[0]?.textContent).toContain('Sort by')

        fixture.componentRef.setInput('sort', { field: AlbumSortField.title, direction: 'desc' })
        fixture.detectChanges()
        expect(select.value).toBe(AlbumSortField.title)
    })
})
