import { ChangeDetectionStrategy, Component, computed, input, output } from '@angular/core'
import type { SongSort, SongSortField } from '@release-maestro/core'
import { IconComponent } from '../icon/icon.component'

/**
 * One sortable column heading: the button, the active-sort affordance and `aria-sort`.
 *
 * It was originally extracted because column widths had to be literal classes, and
 * repeating a ten-line sort button beside each literal width was worse than repeating
 * the width. That reason is gone — widths come from `SONG_TABLE_COLUMN_WIDTHS` and are
 * bound as inline styles now — but the component is not: ten copies of this button
 * would still be ten places to change an `aria-sort` rule or a focus affordance.
 *
 * Width stays the parent's to apply. A heading has no opinion about how wide its
 * column is, and the row cells opposite it are bound from the same constant.
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
            [attr.aria-label]="'Sort by ' + (sortLabel() ?? label())"
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
    /**
     * What the sort button is *called*, when the visible label cannot be spoken. `#` is
     * a symbol, and "Sort by #" is not a sentence; every other heading is already a word
     * and leaves this alone.
     */
    sortLabel = input<string>()
    sort = input.required<SongSort>()
    /** Right-align the label, so it sits over the digits it describes. */
    numeric = input(false)

    sortChange = output<SongSortField>()

    protected isActive = computed(() => this.sort().field == this.field())
    protected ariaSort = computed(() =>
        this.isActive() ? (this.sort().direction == 'asc' ? 'ascending' : 'descending') : 'none',
    )
}
