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
import { RouterLink } from '@angular/router'
import type { AlbumQuery, AlbumRow, BrowseWindow } from '@release-maestro/core'
import type { BrowseResult } from '../../shared/browse/browse-query'
import { IconComponent } from '../../shared/components/icon/icon.component'
import { fileUrl } from '../../shared/utils/file-url.util'

/**
 * The albums grid — the only grid in the library, because `albums.coverPath` is the
 * only artwork the database has. Artists, record labels and genres are lists.
 *
 * **Virtualisation is hand-rolled, for the reason ADR 0004 gives**, and the technique is
 * `SongTableComponent`'s: a spacer as tall as the whole result set gives the scrollbar
 * its range, and only the loaded window is in the DOM, translated into place. The CDK's
 * `*cdkVirtualFor` would need an array as long as the result set, which is the one thing
 * that decision exists to prevent.
 *
 * What a grid adds over a table is that **the row height is not a constant**. A tile is
 * a square cover plus a fixed text block, so its height follows the column width, which
 * follows the container. So the geometry is measured rather than declared, and every
 * scroll calculation reads it from {@link layout} — a `ResizeObserver` and the scroll
 * event both go through `onScroll`, which re-measures and then asks for the window that
 * position means. A window is always requested on a whole-row boundary, so the
 * translated block lines up with the rows the spacer accounts for.
 *
 * There is no selection here. ADR 0004's selection model exists so that actions can
 * address 500k songs without listing them, and the grid has no action to address: a tile
 * navigates. Nothing is dropped by leaving it out — the model is per-surface, and the
 * album detail page's track table brings the song one with it.
 */

/** Narrowest a tile may be before the grid drops a column. */
const MIN_TILE_WIDTH = 170

/** The gap between tiles, in both directions — what the template puts between them. */
const TILE_GAP = 16

/** The canvas's own horizontal padding, `px-4` on each side in the template. */
const CANVAS_PADDING = 16

/** A tile's padding (`p-2`), and the gap between its cover and its text (`gap-2`). */
const TILE_PADDING = 8
const TILE_COVER_GAP = 8

/**
 * Height of the text below a tile's cover: title and album artist in `type-body-sm`
 * (14px × 1.5), the meta line in `type-label-sm` (12px × 1.3).
 *
 * Fixed, because virtualisation has to map a scroll offset to a row — so each line is
 * truncated rather than allowed to wrap and push a tile taller than its neighbours.
 */
const TILE_TEXT_HEIGHT = 58

/**
 * How tall a tile is at a given column width — its padding, a square cover inset by
 * that padding, the gap, the text block, and the padding again.
 *
 * Spelled out rather than folded to a constant offset, because every term is a class
 * in the template and this is the only place the two are kept in step.
 */
const tileHeight = (columnWidth: number): number =>
    TILE_PADDING + (columnWidth - TILE_PADDING * 2) + TILE_COVER_GAP + TILE_TEXT_HEIGHT + TILE_PADDING

/**
 * Tile *rows* fetched beyond the viewport on each side.
 *
 * Far smaller than the track table's twenty, and not because a grid scrolls
 * differently: one row here is a whole row of tiles, so four rows of overscan on a
 * six-column grid is already 48 albums either side. Growing it risks the window
 * outgrowing `BROWSE_WINDOW_MAX_LIMIT`, at which point the main process clamps the
 * limit and the bottom of the viewport goes blank.
 */
const OVERSCAN_ROWS = 4

/** Rows kept visible past the focused tile when the keyboard moves it. */
const SCROLL_PADDING_ROWS = 1

let nextGridId = 0

interface GridLayout {
    columns: number
    columnWidth: number
    /** A tile's own height, which is the height of the row that holds one. */
    tileHeight: number
    /** A tile plus the gap beneath it — the pitch the scroll maths steps in. */
    rowHeight: number
}

const layoutFor = (columns: number, columnWidth: number): GridLayout => ({
    columns,
    columnWidth,
    tileHeight: tileHeight(columnWidth),
    rowHeight: tileHeight(columnWidth) + TILE_GAP,
})

/** Before the grid has been measured. One column, so nothing divides by zero. */
const INITIAL_LAYOUT: GridLayout = layoutFor(1, MIN_TILE_WIDTH)

/**
 * Whether two measurements describe the same grid.
 *
 * The column count and the column width are the only measured terms — everything else
 * in a {@link GridLayout} is derived from them — so comparing the pair compares the
 * whole thing. It is what keeps a resize notification that changed nothing (a height
 * change, a re-attachment, the scrollbar coming and going) from writing the signal at
 * all: an unchanged measurement would otherwise run change detection and re-request the
 * window it already has, once per notification, which is most of them.
 */
const sameLayout = (a: GridLayout, b: GridLayout): boolean =>
    a.columns == b.columns && a.columnWidth == b.columnWidth

@Component({
    selector: 'app-album-grid',
    templateUrl: './album-grid.component.html',
    changeDetection: ChangeDetectionStrategy.OnPush,
    imports: [IconComponent, RouterLink, NgClass],
    host: { class: 'flex min-h-0 min-w-0 flex-1 flex-col' },
})
export class AlbumGridComponent {
    result = input.required<BrowseResult<AlbumRow>>()
    /**
     * The filter, sort and search the window answers. The grid needs the whole query
     * rather than just the sort: a new query is a new result set, and the scroll
     * position measured against the old one is meaningless against it.
     */
    query = input.required<AlbumQuery>()

    viewportChange = output<BrowseWindow>()

    protected readonly fileUrl = fileUrl
    protected readonly gap = TILE_GAP
    protected readonly minTileWidth = MIN_TILE_WIDTH

    private scroller = viewChild<ElementRef<HTMLElement>>('scroller')

    protected layout = signal<GridLayout>(INITIAL_LAYOUT, { equal: sameLayout })

    /** The last window emitted, so an unchanged one never reaches the signal graph. */
    private lastWindow: BrowseWindow | null = null

    protected total = computed(() => this.result().total)
    protected offset = computed(() => this.result().offset)
    protected rows = computed(() => this.result().rows)

    /** How many rows of tiles the whole result set occupies. */
    protected rowCount = computed(() => Math.ceil(this.total() / this.layout().columns))
    protected canvasHeight = computed(() => this.rowCount() * this.layout().rowHeight)

    /**
     * Where the loaded block sits on the canvas.
     *
     * `floor` rather than an exact division because a window requested under a previous
     * column count can still be in flight when a resize changes it. The block lands on
     * the nearest row rather than at a fractional offset, and the measurement the resize
     * triggers corrects it on the next frame.
     */
    protected windowTop = computed(
        () => Math.floor(this.offset() / this.layout().columns) * this.layout().rowHeight,
    )

    /**
     * The absolute index of the first tile in each rendered row.
     *
     * The window is a flat list of albums and the DOM needs rows, because a `role="row"`
     * per line of tiles is what makes the grid navigable — a flat run of gridcells has
     * no rows for `aria-rowindex` to number. Derived rather than tracked: the offset is
     * always row-aligned, so slicing the window into groups of `columns` reproduces
     * exactly the rows the canvas has reserved space for.
     */
    protected windowRowStarts = computed(() => {
        const { columns } = this.layout()
        const first = this.offset()
        const count = this.rows().length
        const starts: number[] = []
        for (let index = 0; index < count; index += columns) starts.push(first + index)
        return starts
    })

    protected columnIndices = computed(() =>
        Array.from({ length: this.layout().columns }, (_column, index) => index),
    )

    /**
     * The tile that currently has focus, which is where the next arrow key moves from.
     *
     * Written by the tiles' own focus handler rather than inferred, so it always agrees
     * with the document: a tile can take focus by being clicked or tabbed to as well as
     * by being arrowed to, and a second copy of "where am I" that only movement updated
     * would disagree with the focus ring the user can see.
     */
    protected focusedIndex = signal(NO_FOCUS)

    /**
     * The one tile in the tab order — a roving tabindex.
     *
     * The window holds a screenful of tiles whose identity changes as it scrolls, so
     * leaving them all tabbable would put ~150 stops in the tab order that move
     * underneath the user. Instead Tab reaches one tile and the arrows do the rest, which
     * is the grid pattern; **DOM focus really moves**, so Enter, cmd-click and the
     * context menu are the link's own and need nothing from this component.
     *
     * It falls back to the first tile in the window whenever the focused one is not in
     * it. Without that, scrolling the focused tile out of the loaded window would take
     * the grid's only tab stop with it and leave the whole thing unreachable by keyboard.
     */
    protected tabbableIndex = computed(() => {
        const first = this.offset()
        const count = this.rows().length
        if (count == 0) return NO_FOCUS

        const focused = this.focusedIndex()
        const withinWindow = focused >= first && focused < first + count
        return withinWindow ? focused : first
    })

    private readonly tileIdPrefix = `album-tile-${nextGridId++}`

    protected tileElementId = (index: number): string => `${this.tileIdPrefix}-${index}`

    private destroyRef = inject(DestroyRef)

    constructor() {
        // Measuring on a `ResizeObserver` rather than once on render, because the grid is
        // often laid out while its branch of the shell is still detached — measured then,
        // it has no width, and the first window would be a guess against a container of
        // zero. Attaching, laying out and resizing all arrive here as a size change.
        afterNextRender(() => {
            const element = this.scroller()?.nativeElement
            if (!element) return

            const observer = new ResizeObserver(() => this.onScroll())
            observer.observe(element)
            this.destroyRef.onDestroy(() => observer.disconnect())
        })

        // A new query is a new result set. Scroll position and focus both belong to the
        // old one — 5,000 albums down a grid that now has three leaves the window
        // translated far below anything visible, and the focused tile is an album the
        // filter may well have excluded.
        effect(() => {
            this.query()
            untracked(() => {
                this.lastWindow = null
                this.focusedIndex.set(NO_FOCUS)
                this.scroller()?.nativeElement?.scrollTo({ top: 0 })
            })
        })
    }

    /**
     * Derive the grid geometry from the container.
     *
     * The column count is what a `repeat(auto-fill, minmax(…))` would pick, computed
     * here instead because virtualisation has to know it: the row height, the canvas
     * height and every scroll-offset-to-index conversion are all functions of it, and
     * CSS will not say what it chose. The template still declares the minimum, so a
     * measurement that has not caught up yet cannot shrink the tiles past it — see the
     * track definition there.
     *
     * Writing the same measurement twice is not a change; {@link sameLayout} is what
     * makes that true.
     */
    private measure(): void {
        const element = this.scroller()?.nativeElement
        if (!element) return

        const available = element.clientWidth - CANVAS_PADDING * 2
        if (available <= 0) return

        const columns = Math.max(1, Math.floor((available + TILE_GAP) / (MIN_TILE_WIDTH + TILE_GAP)))
        const columnWidth = (available - TILE_GAP * (columns - 1)) / columns

        this.layout.set(layoutFor(columns, columnWidth))
    }

    /**
     * Re-measure the container, then translate the scroll position into the window to
     * fetch. Both the scroll event and the `ResizeObserver` land here, because the
     * window a scroll position means depends on the geometry a resize changes — and
     * measuring first means a scroll also re-syncs a layout that somehow went stale,
     * rather than computing a window against a column count that is no longer true.
     *
     * The offset is always a multiple of the column count. It has to be: the loaded
     * block is positioned by whole rows, so a window starting mid-row would draw its
     * first tiles in the wrong column and shift every tile after them.
     */
    protected onScroll(): void {
        this.measure()

        const element = this.scroller()?.nativeElement
        if (!element) return

        const { columns, rowHeight } = this.layout()

        const firstVisibleRow = Math.floor(element.scrollTop / rowHeight)
        const visibleRows = Math.ceil(element.clientHeight / rowHeight)
        const startRow = Math.max(0, firstVisibleRow - OVERSCAN_ROWS)

        const offset = startRow * columns
        const limit = (visibleRows + OVERSCAN_ROWS * 2) * columns

        if (offset == this.lastWindow?.offset && limit == this.lastWindow.limit) return

        this.lastWindow = { offset, limit }
        this.viewportChange.emit(this.lastWindow)
    }

    protected rowAt(index: number): AlbumRow | undefined {
        return this.rows()[index - this.offset()]
    }

    /**
     * What assistive tech reads for a tile, and the tooltip a truncated one gets.
     *
     * Spelled out rather than left to the visible text, which is three separately
     * truncated lines: "Untrue by Burial, 2007, 13 tracks" is what someone would say.
     */
    protected tileLabel(row: AlbumRow): string {
        const artist = row.albumArtistText ? ` by ${row.albumArtistText}` : ''
        const year = row.year == null ? '' : `, ${row.year}`
        const tracks = `, ${row.trackCount} ${row.trackCount == 1 ? 'track' : 'tracks'}`
        return `${row.title}${artist}${year}${tracks}`
    }

    protected onTileFocus(index: number): void {
        this.focusedIndex.set(index)
    }

    /**
     * Arrow keys move focus a tile at a time horizontally and a whole row vertically,
     * per the ARIA grid pattern. Enter and Space are left to the anchor the tile is.
     *
     * Bound on the tile rather than on the scroller, because the tile is what has focus:
     * the scroller is not in the tab order at all — its only tab stop is the one tile
     * {@link tabbableIndex} nominates — and a key handler on an element that can never be
     * focused is exactly what `interactive-supports-focus` exists to catch.
     */
    protected onKeydown(event: KeyboardEvent): void {
        const lastIndex = this.total() - 1
        if (lastIndex < 0) return

        const next = this.movedIndex(event, lastIndex)
        if (next == null) return

        event.preventDefault()
        this.moveFocusTo(next)
    }

    private movedIndex(event: KeyboardEvent, lastIndex: number): number | null {
        const { columns, rowHeight } = this.layout()
        // Whatever is focused, which the tiles' focus handler keeps true. Falling back to
        // the window's first tile covers a key pressed after the focused one scrolled out
        // of the window and took the focus ring with it.
        const current = this.focusedIndex() == NO_FOCUS ? this.tabbableIndex() : this.focusedIndex()
        if (current == NO_FOCUS) return null

        const pageRows = Math.max(
            1,
            Math.floor((this.scroller()?.nativeElement.clientHeight ?? 0) / rowHeight) - 1,
        )

        switch (event.key) {
            case 'ArrowRight':
                return Math.min(lastIndex, current + 1)
            case 'ArrowLeft':
                return Math.max(0, current - 1)
            case 'ArrowDown':
                return Math.min(lastIndex, current + columns)
            case 'ArrowUp':
                return Math.max(0, current - columns)
            case 'PageDown':
                return Math.min(lastIndex, current + pageRows * columns)
            case 'PageUp':
                return Math.max(0, current - pageRows * columns)
            case 'Home':
                return 0
            case 'End':
                return lastIndex
            default:
                return null
        }
    }

    /**
     * Move focus to a tile, scrolling it into view first.
     *
     * The tile may be outside the loaded window after a jump to the end, in which case
     * there is no element to focus yet. Recording the index and scrolling is still
     * right: the scroll triggers the window that will render it, and `focusRenderedTile`
     * picks the focus up once it exists.
     */
    private moveFocusTo(index: number): void {
        this.focusedIndex.set(index)
        this.scrollIndexIntoView(index)
        this.focusRenderedTile(index)
    }

    private focusRenderedTile(index: number): void {
        document.getElementById(this.tileElementId(index))?.focus({ preventScroll: true })
    }

    private scrollIndexIntoView(index: number): void {
        const element = this.scroller()?.nativeElement
        if (!element) return

        const { columns, rowHeight } = this.layout()
        const padding = SCROLL_PADDING_ROWS * rowHeight
        const top = Math.floor(index / columns) * rowHeight
        const bottom = top + rowHeight

        if (top - padding < element.scrollTop) {
            element.scrollTop = Math.max(0, top - padding)
        } else if (bottom + padding > element.scrollTop + element.clientHeight) {
            element.scrollTop = bottom + padding - element.clientHeight
        }
    }
}

/** No tile has been reached yet, so nothing is in the tab order but the grid itself. */
const NO_FOCUS = -1
