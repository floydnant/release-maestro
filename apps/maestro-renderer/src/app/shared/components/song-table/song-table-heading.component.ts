import { ChangeDetectionStrategy, Component, computed, input, output } from '@angular/core'
import type { SongSort, SongSortField } from '@release-maestro/core'
import { IconComponent } from '../icon/icon.component'

/**
 * One sortable column heading.
 *
 * It exists because column widths have to be written as literal classes — a class
 * list assembled from a column definition is invisible to the design-system
 * validator — and repeating a ten-line sort button beside each literal width would
 * be far worse than repeating the width. The parent applies the width; this owns the
 * button, the active-sort affordance and `aria-sort`.
 */
@Component({
    selector: 'app-song-table-heading',
    changeDetection: ChangeDetectionStrategy.OnPush,
    imports: [IconComponent],
    host: {
        role: 'columnheader',
        class: 'block border-b border-border-subtle',
        '[attr.aria-sort]': 'ariaSort()',
    },
    template: `
        <button
            type="button"
            class="type-label-sm flex w-full items-center gap-1 p-2 text-content-muted"
            [class.justify-end]="numeric()"
            [class.text-content-primary]="isActive()"
            [attr.aria-label]="'Sort by ' + label()"
            (click)="sortChange.emit(field())"
        >
            <span class="truncate">{{ label() }}</span>
            @if (isActive()) {
                <app-icon
                    [name]="sort().direction === 'asc' ? 'octTriangleUp' : 'octTriangleDown'"
                    size="12"
                    color="content.action"
                ></app-icon>
            }
        </button>
    `,
})
export class SongTableHeadingComponent {
    field = input.required<SongSortField>()
    label = input.required<string>()
    sort = input.required<SongSort>()
    /** Right-align the label, so it sits over the digits it describes. */
    numeric = input(false)

    sortChange = output<SongSortField>()

    protected isActive = computed(() => this.sort().field == this.field())
    protected ariaSort = computed(() =>
        this.isActive() ? (this.sort().direction == 'asc' ? 'ascending' : 'descending') : 'none',
    )
}
