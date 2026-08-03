import { NgClass } from '@angular/common'
import {
    afterNextRender,
    ChangeDetectionStrategy,
    Component,
    computed,
    DestroyRef,
    effect,
    ElementRef,
    inject,
    input,
    output,
    signal,
    untracked,
    viewChild,
} from '@angular/core'
import type {
    ArtistCreditSegment,
    BrowseWindow,
    SongQuery,
    SongRow,
    SongSortField,
} from '@release-maestro/core'
import type { BrowseResult } from '../../browse/browse-query'
import {
    anchorAfterRefetch,
    applySongSelectionGesture,
    clearSelection,
    isEmptySelection,
    isSelected,
    isSelectionModifierHeld,
    selectAll,
    selectionSize,
    type SongSelectionAnchor,
    type SongSelectionState,
} from '../../browse/song-selection'
import { fileUrl } from '../../utils/file-url.util'
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
 * gesture results. It owns only what is genuinely its own — the cursor the next arrow
 * key moves from, and the anchor a shift-click extends from.
 *
 * **There is one row state, not two.** Arrow keys move the selection rather than a
 * separate cursor, so the selected row is the current row and needs no ring of its
 * own; the grid has no focus ring either, because the selection is the focus
 * indicator and `aria-activedescendant` carries it to assistive tech. That puts the
 * whole weight of "where am I" on how a selected row is drawn, which is why it is
 * marked by a bar as well as a background — a state carried by colour alone is one
 * some people cannot see.
 *
 * **The grid is one tab stop.** Every control inside a row is `tabindex="-1"` and
 * reached with the left and right arrows, per the ARIA grid pattern the vertical keys
 * already follow. A window of 60 rows would otherwise sit on ~240 tab stops that
 * change identity under the user as it scrolls.
 */

/** Row height in pixels. Fixed, because virtualisation needs to map scroll offset to index. */
export const ROW_HEIGHT = 40

/** Rows fetched beyond the viewport on each side, so scrolling does not chase the data. */
const OVERSCAN_ROWS = 20

let nextTableId = 0

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
        '(document:mousedown)': 'onDocumentPointerDown($event)',
    },
})
export class SongTableComponent {
    /** The loaded window, its offset, and the total the scrollbar is sized from. */
    result = input.required<BrowseResult<SongRow>>()
    /**
     * The filter, sort and search the window answers. The table needs the whole query
     * rather than just the sort, because a *new* query means a new result set and the
     * scroll position from the old one has to go with it.
     */
    query = input.required<SongQuery>()
    selection = input.required<SongSelectionState>()

    sortChange = output<SongSortField>()
    selectionChange = output<SongSelectionState>()
    viewportChange = output<BrowseWindow>()
    entityFilter = output<EntityFilterRequest>()
    /**
     * Scope the list to missing tracks.
     *
     * The affordance is the missing badge itself, which is the only place it can be
     * both discoverable and unobtrusive: it exists exactly when there is something to
     * filter for, and costs nothing when there is not.
     */
    filterMissing = output<void>()

    protected readonly rowHeight = ROW_HEIGHT

    private scroller = viewChild<ElementRef<HTMLElement>>('scroller')
    /** Where a shift-extension starts from, and whether it adds, replaces or removes. */
    private anchor: SongSelectionAnchor | null = null
    /** The total the anchor's indices were measured against — see {@link liveAnchor}. */
    private anchorTotal = 0
    /**
     * Where the next arrow key moves from. Never drawn: arrow keys move the
     * *selection*, so the selected row is the cursor, and there is no second state to
     * show. It exists only as the origin for the next move and for
     * `aria-activedescendant`.
     */
    private cursorIndex = signal(0)

    protected sort = computed(() => this.query().sort)
    protected total = computed(() => this.result().total)
    protected offset = computed(() => this.result().offset)
    protected rows = computed(() => this.result().rows)
    protected canvasHeight = computed(() => this.total() * ROW_HEIGHT)
    protected windowTop = computed(() => this.offset() * ROW_HEIGHT)
    protected selectedCount = computed(() => selectionSize(this.selection()))

    /** Unique per table instance, so two tables on a page cannot collide on row ids. */
    private readonly rowIdPrefix = `song-row-${nextTableId++}`

    protected rowElementId = (index: number): string => `${this.rowIdPrefix}-${index}`

    /**
     * The row assistive tech should treat as current. Only set while that row is
     * actually rendered — pointing at an element that does not exist is worse than
     * pointing at nothing.
     */
    protected activeDescendantId = computed(() => {
        const index = this.cursorIndex()
        const first = this.offset()
        const withinWindow = index >= first && index < first + this.rows().length
        return withinWindow ? this.rowElementId(index) : null
    })

    private destroyRef = inject(DestroyRef)

    constructor() {
        // The starting window is a guess made before the table has a height — and the
        // table is often measured while its branch of the shell is still detached, so
        // that guess can be measured against a height of zero and leave the list with
        // blank rows below the fold until something happens to re-trigger a fetch.
        //
        // A ResizeObserver closes that whole class of bug: attaching, laying out and
        // resizing all surface as a size change, and each one re-measures the window.
        afterNextRender(() => {
            const element = this.scroller()?.nativeElement
            if (!element) return

            const observer = new ResizeObserver(() => this.onScroll())
            observer.observe(element)
            this.destroyRef.onDestroy(() => observer.disconnect())
        })

        // A new query is a new result set, and the scroll position measured against
        // the old one is meaningless against it — 5,000 rows down a list that now has
        // three leaves the window translated far below anything visible, so the table
        // renders blank until a scroll or resize happens to re-measure it.
        //
        // An effect because the outcome is a DOM side effect, not derived state.
        effect(() => {
            this.query()
            untracked(() => this.scroller()?.nativeElement?.scrollTo({ top: 0 }))
        })
    }

    protected isRowSelected(row: SongRow, index: number): boolean {
        return isSelected(this.selection(), { id: row.id, index })
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

        // A press that lands on a control inside the row belongs to that control —
        // unless a selection modifier is down, in which case the user is plainly
        // building a selection and a link would be the last thing they meant.
        // Selection runs on mousedown so a drag feels immediate, and mousedown fires
        // before click, so stopping propagation in the link handler is too late.
        if (!isSelectionModifierHeld(event) && (event.target as HTMLElement | null)?.closest('button, a')) {
            return
        }

        event.preventDefault()
        this.cursorIndex.set(index)
        this.applyGesture(event, index, row)

        // Take focus so the keyboard works immediately. Applying the gesture first
        // means the grid is never focused with an empty selection here, so the
        // focus handler below leaves the click's own result alone.
        this.scroller()?.nativeElement.focus({ preventScroll: true })
    }

    /**
     * Give the grid a current row when the keyboard arrives at it.
     *
     * The container has no focus ring of its own any more, so the selected row *is*
     * the focus indicator — landing here with nothing selected would mean focus with
     * nowhere visible to be. Only for keyboard focus: a pointer press has already
     * said what it wanted.
     */
    protected onGridFocus(): void {
        const scroller = this.scroller()?.nativeElement
        if (!scroller?.matches(':focus-visible')) return
        if (this.total() == 0 || !isEmptySelection(this.selection())) return

        this.moveTo(Math.min(this.cursorIndex(), this.total() - 1), { extend: false })
    }

    /**
     * Clear the selection when a press lands anywhere that is not a row — blank space
     * under the last row, a margin, the toolbar, another page — which is what every
     * other app does.
     *
     * The only exception is the scrollbar, and it has to be identified by geometry
     * rather than by "the press landed on the scroller": margins and padding land
     * there too, and treating those as scrollbar presses is what left whole strips of
     * the table unable to clear a selection.
     */
    protected onDocumentPointerDown(event: MouseEvent): void {
        if (event.button != 0) return

        const scroller = this.scroller()?.nativeElement
        const target = event.target
        if (!scroller || !(target instanceof Element)) return
        if (target.closest('[role="row"][aria-selected]')) return
        if (isScrollbarPress(scroller, event)) return
        if (isEmptySelection(this.selection())) return

        this.anchor = null
        this.selectionChange.emit(clearSelection(this.selection()))
    }

    /**
     * Arrow keys move the **selection**, the way a file list does — there is no second
     * cursor travelling independently of it, which is what made the old model feel
     * like two things at once. Shift extends from the anchor instead of replacing.
     */
    protected onKeydown(event: KeyboardEvent): void {
        const lastIndex = this.total() - 1
        if (lastIndex < 0) return

        if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() == 'a') {
            event.preventDefault()
            // Both of these replace the selection wholesale, so there is no longer an
            // anchor a shift-extension could sensibly measure from.
            this.anchor = null
            this.selectionChange.emit(selectAll(this.selection().query, this.total()))
            return
        }

        if (event.key == 'Escape') {
            event.preventDefault()
            this.anchor = null
            this.focusGrid()
            this.selectionChange.emit(clearSelection(this.selection()))
            return
        }

        if (event.key == 'ArrowRight' || event.key == 'ArrowLeft') {
            if (this.moveWithinRow(event.key == 'ArrowRight' ? 1 : -1)) event.preventDefault()
            return
        }

        const nextIndex = this.movedIndex(event, lastIndex)
        if (nextIndex == null) return

        event.preventDefault()
        this.moveTo(nextIndex, { extend: event.shiftKey })
    }

    /**
     * Move focus along the controls inside the current row.
     *
     * The grid is a single tab stop — every control in a row carries `tabindex="-1"`,
     * because a 60-row window otherwise puts ~240 stops between the table and whatever
     * follows it, and they change identity under the user as the window rebuilds on
     * scroll. That is only tenable if the keyboard can still reach them, which is what
     * this is: the horizontal half of the grid pattern the vertical keys already
     * implement. Stepping left off the first control returns focus to the grid, so the
     * arrow keys go back to moving the selection.
     *
     * @returns whether the key was consumed.
     */
    private moveWithinRow(step: number): boolean {
        const controls = this.rowControls()
        if (controls.length == 0) return false

        const active = document.activeElement
        const current = controls.findIndex(control => control == active)

        // Entering the row from the grid itself starts at the first control.
        const next = current < 0 ? (step > 0 ? 0 : -1) : current + step
        if (next < 0) {
            this.focusGrid()
            return true
        }
        controls[next]?.focus()
        return true
    }

    /**
     * The focusable controls of the row the cursor is on, in visual order.
     *
     * Read off the DOM rather than modelled in TypeScript: which cells carry a control
     * depends on the row — a present track has no missing badge, a track with no label
     * has no label link — so the list is genuinely a property of what was rendered.
     * Row ids are unique per document, which is what `rowIdPrefix` is for.
     */
    private rowControls(): HTMLElement[] {
        const row = document.getElementById(this.rowElementId(this.cursorIndex()))
        return row ? Array.from(row.querySelectorAll<HTMLElement>('button, a[href]')) : []
    }

    private focusGrid(): void {
        this.scroller()?.nativeElement.focus({ preventScroll: true })
    }

    /** Put the cursor on a row, selecting it — or extending the selection to it. */
    private moveTo(index: number, { extend }: { extend: boolean }): void {
        // Vertical movement is about rows, so focus belongs back on the grid rather
        // than on whatever control in the old row the user had stepped into.
        this.focusGrid()
        this.cursorIndex.set(index)
        this.scrollIndexIntoView(index)

        // The row may be outside the loaded window after a jump to the end, in which
        // case there is no id to send and the gesture selects it as a one-row range
        // instead — see `applySelectionGesture`.
        const row = this.rows()[index - this.offset()]
        this.emitGesture({ index, id: row?.id ?? null, shiftKey: extend, toggleKey: false })
    }

    protected onArtistSegment(event: MouseEvent, segment: ArtistCreditSegment): void {
        // The cell sits inside a row that also selects; a plain click on the link means
        // the artist, not the row. With a selection modifier down it means the row, and
        // the mousedown handler has already dealt with it.
        event.stopPropagation()
        if (isSelectionModifierHeld(event)) return
        this.entityFilter.emit({ kind: 'artist', id: segment.artistId, name: segment.creditedAs })
    }

    protected onEntity(event: MouseEvent, kind: EntityFilterKind, id: string, name: string): void {
        event.stopPropagation()
        if (isSelectionModifierHeld(event)) return
        this.entityFilter.emit({ kind, id, name })
    }

    protected onMissingBadge(event: MouseEvent): void {
        event.stopPropagation()
        if (isSelectionModifierHeld(event)) return
        this.filterMissing.emit()
    }

    protected rowLabel(row: SongRow): string {
        const artist = row.artistText ? ` by ${row.artistText}` : ''
        return `${row.title}${artist}${row.present ? '' : ' — missing'}`
    }

    protected formatDuration = formatDuration
    protected formatDateShort = formatDateShort
    protected formatBpm = formatBpm
    protected fileUrl = fileUrl

    // -----------------------------------------------------------------------

    private applyGesture(event: MouseEvent, index: number, row: SongRow): void {
        this.emitGesture({
            index,
            id: row.id,
            shiftKey: event.shiftKey,
            toggleKey: event.metaKey || event.ctrlKey,
        })
    }

    private emitGesture(gesture: {
        index: number
        id: string | null
        shiftKey: boolean
        toggleKey: boolean
    }): void {
        const { selection, anchor } = applySongSelectionGesture(this.selection(), this.liveAnchor(), gesture)
        this.anchor = anchor
        this.anchorTotal = this.total()
        this.selectionChange.emit(selection)
    }

    /**
     * The anchor, dropped if the result set has changed size since it was set.
     *
     * The parent already clears a ranged selection when a refetch changes the total,
     * but the anchor lives here and outlived it — and because an extension re-applies
     * from `anchor.base`, the next shift-click rebuilt the range that had just been
     * cleared. An anchor is a bare index, so a total change invalidates it outright.
     */
    private liveAnchor(): SongSelectionAnchor | null {
        this.anchor = anchorAfterRefetch(this.anchor, this.anchorTotal, this.total())
        this.anchorTotal = this.total()
        return this.anchor
    }

    private movedIndex(event: KeyboardEvent, lastIndex: number): number | null {
        const current = this.cursorIndex()
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

/**
 * Whether a press landed on the scroller's own scrollbars, which sit outside its
 * client box. Overlay scrollbars take up no client space and never reach here.
 */
const isScrollbarPress = (scroller: HTMLElement, event: MouseEvent): boolean => {
    const bounds = scroller.getBoundingClientRect()
    return (
        event.clientX > bounds.left + scroller.clientWidth ||
        event.clientY > bounds.top + scroller.clientHeight
    )
}
