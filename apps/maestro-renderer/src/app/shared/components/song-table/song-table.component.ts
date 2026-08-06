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
    model,
    output,
    untracked,
    viewChild,
} from '@angular/core'
import type { BrowseWindow, SongQuery, SongRow, SongSortField } from '@release-maestro/core'
import type { BrowseResult } from '../../browse/browse-query'
import {
    applySongSelectionGesture,
    clearSelection,
    isEmptySelection,
    isSelected,
    isSelectionModifierHeld,
    NO_CURSOR,
    selectAll,
    selectionSize,
    type SongSelectionState,
} from '../../browse/song-selection'
import { SongTableHeadingComponent } from './song-table-heading.component'
import { SongTableRowComponent } from './song-table-row.component'

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
 * whole next selection. The selection is a write-through model rather than a separate
 * local copy: a gesture updates it synchronously before notifying the parent, so the
 * next pointer or keyboard event cannot reduce against the previous selection while
 * Angular is still rendering the parent binding. The cursor and shift-anchor live in
 * that same selection value, because they are positions *within* it and every rule for
 * when they go stale is a rule the selection already has.
 *
 * **There is one row state, not two.** Arrow keys move the selection rather than a
 * separate cursor, so the selected row is the current row and needs no ring of its
 * own; the grid has no focus ring either, because the selection is the focus
 * indicator and `aria-activedescendant` carries it to assistive tech. That puts the
 * whole weight of "where am I" on the selected row's background, so its contrast
 * against the canvas is load-bearing rather than decorative.
 *
 * **The grid is one tab stop.** Every control inside a row is `tabindex="-1"` and
 * reached with the left and right arrows, per the ARIA grid pattern the vertical keys
 * already follow. A window of 60 rows would otherwise sit on ~240 tab stops that
 * change identity under the user as it scrolls.
 */

/** Row height in pixels. Fixed, because virtualisation needs to map scroll offset to index. */
export const ROW_HEIGHT = 40

/**
 * Column widths in pixels, in visual order — the single declaration the header and
 * every row bind to.
 *
 * Bound as inline widths rather than written as `w-52` utilities on each of the
 * twenty-two cells. Two lists of literal widths in two templates drift the moment one
 * is edited alone, which is what the "edit these together" comment used to be guarding.
 *
 * A CSS grid would express this better and cannot be used: the header and the rows are
 * necessarily separate grids — virtualisation puts the rows inside an absolutely
 * positioned, transformed window that the header is not in — so each one sizes its
 * tracks against its own container and its own content. `subgrid` is the feature that
 * would fix that, and it needs a common grid ancestor the virtualisation cannot provide.
 *
 * Inline widths are also where resizable columns have to end up, so this is the shape
 * that survives.
 */
export const SONG_TABLE_COLUMN_WIDTHS = {
    cover: 64,
    title: 256,
    artist: 208,
    album: 208,
    genre: 128,
    bpm: 64,
    musicalKey: 52,
    duration: 64,
    year: 64,
    recordLabel: 128,
    dateAdded: 128,
} as const

/** One of the table's columns, named as {@link SONG_TABLE_COLUMN_WIDTHS} names it. */
export type SongTableColumn = keyof typeof SONG_TABLE_COLUMN_WIDTHS

/** Rows fetched beyond the viewport on each side, so scrolling does not chase the data. */
const OVERSCAN_ROWS = 20

/**
 * Rows kept visible past the cursor when the keyboard moves it. Distinct from
 * {@link OVERSCAN_ROWS}, which is about what is *fetched*; this is about what the user
 * can see ahead of where they are.
 */
const SCROLL_PADDING_ROWS = 4

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
    imports: [NgClass, SongTableHeadingComponent, SongTableRowComponent],
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
    selection = model.required<SongSelectionState>()
    /**
     * Columns the surface leaves out because its own chrome already says them — an
     * album's tracks under an album header repeat one title down the whole column.
     *
     * A list rather than a flag per column, because slices 3–5 bring an artist, a record
     * label and a genre page and each one suppresses its own; four booleans would say
     * the same thing four times.
     */
    hiddenColumns = input<readonly SongTableColumn[]>([])

    sortChange = output<SongSortField>()
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
    protected readonly columns = SONG_TABLE_COLUMN_WIDTHS

    /** Asked once per heading and once per cell, so it is a set rather than a scan. */
    protected hidden = computed(() => new Set(this.hiddenColumns()))

    private scroller = viewChild<ElementRef<HTMLElement>>('scroller')
    /**
     * The sticky header, referenced rather than queried by class. Its class is a
     * descriptor — a human convention nothing validates — so a typo in one would have
     * been silently behavioural instead of a compile error.
     */
    private header = viewChild<ElementRef<HTMLElement>>('header')
    /** The last window emitted, so an unchanged one never reaches the signal graph. */
    private lastWindow: BrowseWindow | null = null
    /**
     * Set while a pointer press is taking focus, so {@link onGridFocus} leaves the
     * click's own result alone.
     *
     * The press applies its gesture and then focuses the grid, but the selection it
     * emitted has not come back through the input yet — so the focus handler would
     * read the *previous* selection, find it empty, and put the cursor back where that
     * one had been. `focus()` dispatches synchronously, so the flag spans exactly the
     * call it needs to.
     */
    private focusFromPointer = false

    /**
     * Where the next arrow key moves from. Never drawn: arrow keys move the
     * *selection*, so the selected row is the cursor, and there is no second state to
     * show. It exists only as the origin for the next move and for
     * `aria-activedescendant`.
     *
     * Read off the selection rather than held here. It used to be a field, and it
     * outlived the selection it belonged to: re-sorting cleared the selection but left
     * the cursor where the old one had been, so the next arrow key resumed from a row
     * the user was no longer on.
     */
    protected cursorIndex = computed(() => this.selection().cursor)

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
            untracked(() => {
                // The parent resets its viewport for a new query, so the last window
                // this emitted is no longer what it holds — keeping it would let the
                // comparison in `onScroll` swallow the measurement that re-syncs them.
                this.lastWindow = null
                this.scroller()?.nativeElement?.scrollTo({ top: 0 })
            })
        })
    }

    protected isRowSelected(row: SongRow, index: number): boolean {
        return isSelected(this.selection(), { id: row.id, index })
    }

    /**
     * Translate a scroll position into the window the query primitive should fetch.
     * Overscan on both sides means a slow flick does not outrun the data.
     *
     * **Deliberately not wrapped in `requestAnimationFrame`.** Scrolling here is native:
     * a spacer of `total × ROW_HEIGHT` gives the scrollbar its range and the loaded
     * window is translated into place, so the browser composites the scroll and nothing
     * repositions per frame in JS. There is no animation loop to align to, and browsers
     * already dispatch `scroll` at most once per frame — a rAF would defer this work
     * without doing less of it.
     *
     * What was worth removing is emitting a window that has not changed. The offset
     * only moves once per row scrolled and the limit almost never moves, so most scroll
     * events used to write a signal and run change detection to produce a value
     * `browse-query` then discarded. Comparing here keeps that off the signal graph
     * entirely, rather than filtering it one step too late.
     */
    protected onScroll(): void {
        const element = this.scroller()?.nativeElement
        if (!element) return

        const firstVisible = Math.floor(element.scrollTop / ROW_HEIGHT)
        const visibleCount = Math.ceil(element.clientHeight / ROW_HEIGHT)
        const offset = Math.max(0, firstVisible - OVERSCAN_ROWS)
        const limit = visibleCount + OVERSCAN_ROWS * 2

        if (offset == this.lastWindow?.offset && limit == this.lastWindow.limit) return

        this.lastWindow = { offset, limit }
        this.viewportChange.emit(this.lastWindow)
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
        this.applyGesture(event, index, row)

        // Take focus so the keyboard works immediately, without the focus handler
        // second-guessing the gesture that just ran.
        this.focusFromPointer = true
        this.scroller()?.nativeElement.focus({ preventScroll: true })
        this.focusFromPointer = false
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
        if (this.focusFromPointer) return

        const scroller = this.scroller()?.nativeElement
        if (!scroller?.matches(':focus-visible')) return
        if (this.total() == 0 || !isEmptySelection(this.selection())) return

        this.moveTo(Math.max(0, Math.min(this.cursorIndex(), this.total() - 1)), { extend: false })
    }

    /**
     * Clear the selection when a press lands anywhere that is not a row — blank space
     * under the last row, a margin, the toolbar, another page — which is what every
     * other app does.
     *
     * **The scrollbar is not excepted, deliberately.** There used to be a geometric
     * test for "did this land outside the client box", which is where a *classic*
     * scrollbar sits. It could never work on the platform this ships to first: macOS
     * overlay scrollbars take up no client space at all, so they are drawn over the
     * content and every press on one reads as a press on whatever is beneath it. The
     * check was inert where it mattered and only ever exercised in CI, where it could
     * not fail. Dragging a classic scrollbar now clears the selection, which is the
     * cost of not carrying a guard that does not guard.
     */
    protected onDocumentPointerDown(event: MouseEvent): void {
        if (event.button != 0) return

        const target = event.target
        if (!(target instanceof Element)) return
        if (target.closest('[role="row"][aria-selected]')) return
        if (isEmptySelection(this.selection())) return

        this.selection.set(clearSelection(this.selection()))
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
            // Replaces the selection wholesale, and `selectAll` resets the cursor and
            // anchor with it — there is no longer a row an extension could measure from.
            this.selection.set(selectAll(this.selection().query, this.total()))
            return
        }

        if (event.key == 'Escape') {
            event.preventDefault()
            this.focusGrid()
            this.selection.set(clearSelection(this.selection()))
            return
        }

        if (event.key == 'ArrowRight' || event.key == 'ArrowLeft') {
            if (this.moveWithinRow(event.key == 'ArrowRight' ? 1 : -1)) event.preventDefault()
            return
        }

        const nextIndex = this.movedIndex(event, lastIndex)
        if (nextIndex == null) return

        event.preventDefault()

        // With nothing selected but the cursor still on a row — cmd-clicking the last
        // selected row off leaves it there — the first directional key lands *on* that
        // row rather than moving off it, because there is no selected row to move away
        // from. `NO_CURSOR` is not such a row: Escape and a sort change both reset the
        // cursor, and landing "on" `-1` would select an empty range and leave the grid
        // inert for every key after it. There the move arithmetic already does the
        // right thing — see `BrowseSelectionState.cursor`.
        const cursor = this.cursorIndex()
        if (cursor != NO_CURSOR && isEmptySelection(this.selection())) {
            this.moveTo(Math.min(cursor, lastIndex), { extend: false })
            return
        }

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
        this.scrollIndexIntoView(index)

        // The row may be outside the loaded window after a jump to the end, in which
        // case there is no id to send and the gesture selects it as a one-row range
        // instead — see `applySelectionGesture`.
        const row = this.rows()[index - this.offset()]
        this.emitGesture({ index, id: row?.id ?? null, shiftKey: extend, toggleKey: false })
    }

    protected rowLabel(row: SongRow): string {
        const artist = row.artistText ? ` by ${row.artistText}` : ''
        return `${row.title}${artist}${row.present ? '' : ' — missing'}`
    }

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
        this.selection.set(applySongSelectionGesture(this.selection(), gesture))
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

    /**
     * Keep the cursor row inside the viewport, with room to see where it is going.
     *
     * Scrolling it to the very edge is technically "in view" and useless to read: the
     * next row down is the one you are about to move to, and it is off screen. So the
     * row is kept {@link SCROLL_PADDING_ROWS} rows clear of both edges.
     *
     * The row's position is measured off the DOM when it is rendered, because the
     * canvas carries margins that `index × ROW_HEIGHT` knows nothing about — that gap
     * is what left a downward move showing a sliver of the row it had just selected.
     * A jump past the loaded window has no element to measure and falls back to the
     * arithmetic, which is close enough to land in the right region; the next render
     * corrects it.
     */
    private scrollIndexIntoView(index: number): void {
        const element = this.scroller()?.nativeElement
        if (!element) return

        const padding = SCROLL_PADDING_ROWS * ROW_HEIGHT
        // The header floats over the top of the scroller, so the space behind it is
        // not viewport the cursor can be seen in.
        const header = this.header()?.nativeElement.clientHeight ?? 0

        const rendered = document.getElementById(this.rowElementId(index))
        const top = rendered
            ? rendered.getBoundingClientRect().top - element.getBoundingClientRect().top + element.scrollTop
            : index * ROW_HEIGHT
        const bottom = top + ROW_HEIGHT

        if (top - padding - header < element.scrollTop) {
            element.scrollTop = Math.max(0, top - padding - header)
        } else if (bottom + padding > element.scrollTop + element.clientHeight) {
            element.scrollTop = bottom + padding - element.clientHeight
        }
    }
}
