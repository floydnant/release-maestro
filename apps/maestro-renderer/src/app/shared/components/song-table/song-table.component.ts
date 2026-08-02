import { NgClass } from '@angular/common'
import {
    afterNextRender,
    ChangeDetectionStrategy,
    Component,
    computed,
    ElementRef,
    input,
    output,
    signal,
    viewChild,
} from '@angular/core'
import type {
    ArtistCreditSegment,
    BrowseWindow,
    SongRow,
    SongSort,
    SongSortField,
} from '@release-maestro/core'
import type { BrowseResult } from '../../browse/browse-query'
import {
    isSelected,
    selectAll,
    selectOnly,
    selectRange,
    selectionSize,
    toggleRow,
    type SongSelectionState,
} from '../../browse/song-selection'
import { formatBpm, formatDateShort, formatDuration } from '../../utils/formatting.utils'
import { IconComponent } from '../icon/icon.component'
import { SongTableHeadingComponent } from './song-table-heading.component'

/**
 * The track table, shared between `/tracks` and every detail tab in slices 2–5.
 *
 * **Virtualisation is hand-rolled, deliberately.** The CDK's `*cdkVirtualFor` needs
 * an array as long as the result set to size its scrollbar, and a 500k-entry array
 * in the renderer is exactly what ADR 0004 exists to prevent. Instead a spacer of
 * `total × ROW_HEIGHT` gives the scrollbar its height, and the loaded window is
 * translated into place — so the DOM holds a screenful and memory holds one window.
 *
 * The component is presentational: it renders the window it is given and emits the
 * gesture results. It owns only what is genuinely its own — which row has keyboard
 * focus, and the anchor a shift-click extends from.
 */

/** Row height in pixels. Fixed, because virtualisation needs to map scroll offset to index. */
export const ROW_HEIGHT = 40

/** Rows fetched beyond the viewport on each side, so scrolling does not chase the data. */
const OVERSCAN_ROWS = 20

/** Which catalog entity a cell's link addresses. Filtering by it is the page's call. */
export type EntityFilterKind = 'artist' | 'genre' | 'recordLabel' | 'album'

export interface EntityFilterRequest {
    kind: EntityFilterKind
    id: string
    name: string
}

@Component({
    selector: 'app-song-table',
    templateUrl: './song-table.component.html',
    changeDetection: ChangeDetectionStrategy.OnPush,
    imports: [IconComponent, NgClass, SongTableHeadingComponent],
    host: {
        class: 'flex min-h-0 min-w-0 flex-1 flex-col',
        // A taller window needs more rows than the default window holds, and nothing
        // else would tell us — a resize fires no scroll event.
        '(window:resize)': 'onScroll()',
    },
})
export class SongTableComponent {
    /** The loaded window, its offset, and the total the scrollbar is sized from. */
    result = input.required<BrowseResult<SongRow>>()
    sort = input.required<SongSort>()
    selection = input.required<SongSelectionState>()

    sortChange = output<SongSortField>()
    selectionChange = output<SongSelectionState>()
    viewportChange = output<BrowseWindow>()
    entityFilter = output<EntityFilterRequest>()

    protected readonly rowHeight = ROW_HEIGHT

    private scroller = viewChild<ElementRef<HTMLElement>>('scroller')
    /** Where a shift-click extends from. Null until the user has picked a row. */
    private anchorIndex: number | null = null
    protected focusedIndex = signal(0)
    /**
     * Whether the grid holds keyboard focus. The focus ring is drawn on a row rather
     * than on the grid, so without this the first row would wear a ring from the
     * moment the page loads — which reads as a selection nobody made.
     */
    protected hasFocus = signal(false)

    protected total = computed(() => this.result().total)
    protected offset = computed(() => this.result().offset)
    protected rows = computed(() => this.result().rows)
    protected canvasHeight = computed(() => this.total() * ROW_HEIGHT)
    protected windowTop = computed(() => this.offset() * ROW_HEIGHT)
    protected selectedCount = computed(() => selectionSize(this.selection()))

    constructor() {
        // The default window is a guess made before the table has a height. Measure
        // once the scroller exists, so a tall window is not left with blank rows.
        afterNextRender(() => this.onScroll())
    }

    protected isRowSelected(index: number): boolean {
        return isSelected(this.selection(), index)
    }

    /**
     * Translate a scroll position into the window the query primitive should fetch.
     * Overscan on both sides means a slow flick does not outrun the data, and the
     * primitive's `distinctUntilChanged` swallows the ticks that change nothing.
     */
    protected onScroll(): void {
        const element = this.scroller()?.nativeElement
        if (!element) return

        const firstVisible = Math.floor(element.scrollTop / ROW_HEIGHT)
        const visibleCount = Math.ceil(element.clientHeight / ROW_HEIGHT)
        const offset = Math.max(0, firstVisible - OVERSCAN_ROWS)

        this.viewportChange.emit({ offset, limit: visibleCount + OVERSCAN_ROWS * 2 })
    }

    protected onRowPointerDown(event: MouseEvent, index: number, row: SongRow): void {
        // Only the primary button drives selection; a right-click is for a context
        // menu that does not exist yet and must not silently move the selection.
        if (event.button != 0) return

        // A press that lands on a control inside the row belongs to that control.
        // Selection runs on mousedown so a drag feels immediate, and mousedown fires
        // before click — so stopping propagation in the link handler is too late.
        if ((event.target as HTMLElement | null)?.closest('button, a')) return

        event.preventDefault()
        this.focusedIndex.set(index)
        this.applyGesture(event, index, row)
    }

    protected onKeydown(event: KeyboardEvent): void {
        const lastIndex = this.total() - 1
        if (lastIndex < 0) return

        if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() == 'a') {
            event.preventDefault()
            this.selectionChange.emit(selectAll(this.selection().query, this.total()))
            return
        }

        if (event.key == 'Escape') {
            event.preventDefault()
            this.selectionChange.emit({ ...this.selection(), ranges: [], excluded: [], included: [] })
            return
        }

        const nextIndex = this.movedIndex(event, lastIndex)
        if (nextIndex == null) {
            if (event.key == ' ' || event.key == 'Enter') {
                event.preventDefault()
                this.selectFocusedRow(event.metaKey || event.ctrlKey)
            }
            return
        }

        event.preventDefault()
        this.focusedIndex.set(nextIndex)
        this.scrollIndexIntoView(nextIndex)

        // Shift-arrow extends from the anchor, which is what makes keyboard range
        // selection feel the same as dragging with the mouse.
        if (event.shiftKey) {
            const anchor = this.anchorIndex ?? nextIndex
            this.anchorIndex = anchor
            this.selectionChange.emit(
                selectRange(this.selection(), {
                    start: Math.min(anchor, nextIndex),
                    end: Math.max(anchor, nextIndex) + 1,
                }),
            )
        }
    }

    protected onArtistSegment(event: MouseEvent, segment: ArtistCreditSegment): void {
        // The cell sits inside a row that also selects; a click on the link means the
        // artist, not the row.
        event.stopPropagation()
        this.entityFilter.emit({ kind: 'artist', id: segment.artistId, name: segment.creditedAs })
    }

    protected onEntity(event: MouseEvent, kind: EntityFilterKind, id: string, name: string): void {
        event.stopPropagation()
        this.entityFilter.emit({ kind, id, name })
    }

    protected rowLabel(row: SongRow): string {
        const artist = row.artistText ? ` by ${row.artistText}` : ''
        return `${row.title}${artist}${row.present ? '' : ' — missing'}`
    }

    protected formatDuration = formatDuration
    protected formatDateShort = formatDateShort
    protected formatBpm = formatBpm

    // -----------------------------------------------------------------------

    private applyGesture(event: MouseEvent, index: number, row: SongRow): void {
        const selected = { id: row.id, index }

        if (event.shiftKey && this.anchorIndex != null) {
            const anchor = this.anchorIndex
            this.selectionChange.emit(
                selectRange(
                    this.selection(),
                    { start: Math.min(anchor, index), end: Math.max(anchor, index) + 1 },
                    { additive: event.metaKey || event.ctrlKey },
                ),
            )
            return
        }

        this.anchorIndex = index

        if (event.metaKey || event.ctrlKey) {
            this.selectionChange.emit(toggleRow(this.selection(), selected))
            return
        }

        this.selectionChange.emit(selectOnly(this.selection().query, selected))
    }

    private selectFocusedRow(additive: boolean): void {
        const index = this.focusedIndex()
        const row = this.rows()[index - this.offset()]
        if (!row) return

        this.anchorIndex = index
        const selected = { id: row.id, index }
        this.selectionChange.emit(
            additive ? toggleRow(this.selection(), selected) : selectOnly(this.selection().query, selected),
        )
    }

    private movedIndex(event: KeyboardEvent, lastIndex: number): number | null {
        const current = this.focusedIndex()
        const pageRows = Math.max(
            1,
            Math.floor((this.scroller()?.nativeElement.clientHeight ?? 0) / ROW_HEIGHT) - 1,
        )

        switch (event.key) {
            case 'ArrowDown':
                return Math.min(lastIndex, current + 1)
            case 'ArrowUp':
                return Math.max(0, current - 1)
            case 'PageDown':
                return Math.min(lastIndex, current + pageRows)
            case 'PageUp':
                return Math.max(0, current - pageRows)
            case 'Home':
                return 0
            case 'End':
                return lastIndex
            default:
                return null
        }
    }

    private scrollIndexIntoView(index: number): void {
        const element = this.scroller()?.nativeElement
        if (!element) return

        const top = index * ROW_HEIGHT
        const bottom = top + ROW_HEIGHT
        if (top < element.scrollTop) element.scrollTop = top
        else if (bottom > element.scrollTop + element.clientHeight) {
            element.scrollTop = bottom - element.clientHeight
        }
    }
}
