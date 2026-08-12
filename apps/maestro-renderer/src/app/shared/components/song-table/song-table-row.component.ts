import { ChangeDetectionStrategy, Component, computed, input, output } from '@angular/core'
import { RouterLink } from '@angular/router'
import type { ArtistCreditSegment, SongRow } from '@release-maestro/core'
import { isSelectionModifierHeld } from '../../browse/song-selection'
import { fileUrl } from '../../utils/file-url.util'
import { formatBpm, formatDateShort, formatDuration } from '../../utils/formatting.utils'
import { IconComponent } from '../icon/icon.component'
import {
    DEFAULT_SONG_TABLE_COLUMNS,
    SONG_TABLE_COLUMN_WIDTHS,
    type EntityFilterKind,
    type EntityFilterRequest,
    type SongTableColumn,
} from './song-table.component'

/**
 * The cells of one track row.
 *
 * Split out of `SongTableComponent` on size alone: the `@for` body it came from was
 * around 160 lines inside a 290-line template, well past what `angular-patterns` asks
 * to keep in one place. Nothing here is shared with anything else, and it is not meant
 * to be — the column set is hand-written per surface, deliberately (ADR 0004, MAE-61);
 * there is no config-driven table to grow towards.
 *
 * **The row element itself stays in the parent**, which keeps `role="row"`, the id the
 * grid's `aria-activedescendant` points at, the selection classes, and the `mousedown`
 * that drives selection. Only the cells live here. That is what lets the parent go on
 * treating a row as one thing while this file only knows how to draw ten columns —
 * and it keeps the class lists literal, which the design-system lint rule requires.
 *
 * Every control is `tabindex="-1"`: the grid is one tab stop and the arrow keys reach
 * these, per the pattern in `SongTableComponent`.
 */
@Component({
    selector: 'app-song-table-row',
    templateUrl: './song-table-row.component.html',
    changeDetection: ChangeDetectionStrategy.OnPush,
    imports: [IconComponent, RouterLink],
    host: { class: 'contents' },
})
export class SongTableRowComponent {
    row = input.required<SongRow>()
    /** Only the empty-cover placeholder needs it — the row's own styling is the parent's. */
    selected = input.required<boolean>()
    /** Passed straight down from the table, so a column keeps its heading and its cells in step. */
    columns = input<readonly SongTableColumn[]>(DEFAULT_SONG_TABLE_COLUMNS)

    /** Shared with the header, so a column has one width — see the constant. */
    protected readonly widths = SONG_TABLE_COLUMN_WIDTHS

    protected shown = computed(() => new Set(this.columns()))

    entityFilter = output<EntityFilterRequest>()
    filterMissing = output<void>()

    protected onArtistSegment(event: MouseEvent, segment: ArtistCreditSegment): void {
        // The cell sits inside a row that also selects; a plain click on the link means
        // the artist, not the row. With a selection modifier down it means the row, and
        // the parent's mousedown handler has already dealt with it.
        event.stopPropagation()
        if (isSelectionModifierHeld(event)) return
        this.entityFilter.emit({ kind: 'artist', id: segment.artistId, name: segment.creditedAs })
    }

    protected onEntity(event: MouseEvent, kind: EntityFilterKind, id: string, name: string): void {
        event.stopPropagation()
        if (isSelectionModifierHeld(event)) return
        this.entityFilter.emit({ kind, id, name })
    }

    /**
     * The album cell is a real link to the album's page, so this only has to keep it out
     * of the row's way — and stop it navigating when the click was building a selection.
     * Cmd-clicking rows is how you pick several, and having one of them jump to another
     * page instead would be the last thing the user meant.
     */
    protected onAlbumLink(event: MouseEvent): void {
        event.stopPropagation()
        if (isSelectionModifierHeld(event)) event.preventDefault()
    }

    protected onMissingBadge(event: MouseEvent): void {
        event.stopPropagation()
        if (isSelectionModifierHeld(event)) return
        this.filterMissing.emit()
    }

    protected formatDuration = formatDuration
    protected formatDateShort = formatDateShort
    protected formatBpm = formatBpm
    protected fileUrl = fileUrl
}
