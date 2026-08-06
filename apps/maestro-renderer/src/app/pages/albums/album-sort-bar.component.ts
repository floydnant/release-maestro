import { ChangeDetectionStrategy, Component, computed, input, output } from '@angular/core'
import { AlbumSortField, type AlbumSort } from '@release-maestro/core'
import { IconComponent } from '../../shared/components/icon/icon.component'

/**
 * The albums grid's sort control.
 *
 * A grid has no column headers, so the sort has to be stated somewhere — this is the
 * one piece of browse chrome the track list did not already need. It is a native
 * `<select>` plus a direction toggle rather than a menu, because that is the control the
 * platform already makes keyboard- and screen-reader-operable.
 *
 * Field and direction are separate controls rather than ten combined options. A user
 * changing "year" to "title" almost never means to change the direction with it, and a
 * combined list makes them re-pick both.
 */

interface SortOption {
    field: AlbumSortField
    label: string
}

/**
 * Added first, because it is the default and a list whose first option is not the one
 * in force reads as though something has already been changed. "Added" rather than
 * "Date added" — it is the word the track table's own column header uses.
 */
const SORT_OPTIONS: SortOption[] = [
    { field: AlbumSortField.dateAdded, label: 'Added' },
    { field: AlbumSortField.title, label: 'Title' },
    { field: AlbumSortField.albumArtist, label: 'Album artist' },
    { field: AlbumSortField.year, label: 'Year' },
    { field: AlbumSortField.recordLabel, label: 'Record label' },
]

@Component({
    selector: 'app-album-sort-bar',
    templateUrl: './album-sort-bar.component.html',
    changeDetection: ChangeDetectionStrategy.OnPush,
    imports: [IconComponent],
    host: { class: 'flex shrink-0 items-center gap-2 px-4 pb-2' },
})
export class AlbumSortBarComponent {
    sort = input.required<AlbumSort>()

    /**
     * The field the user picked. Direction is the page's call, not this component's —
     * `nextAlbumSort` gives a newly chosen column its natural direction, and repeating
     * that rule here would be a second copy of it.
     */
    sortField = output<AlbumSortField>()
    directionToggle = output<void>()

    protected readonly options = SORT_OPTIONS

    protected isAscending = computed(() => this.sort().direction == 'asc')

    protected directionLabel = computed(() =>
        this.isAscending() ? 'Sorted ascending — sort descending' : 'Sorted descending — sort ascending',
    )

    protected onFieldChange(event: Event): void {
        this.sortField.emit((event.target as HTMLSelectElement).value as AlbumSortField)
    }
}
