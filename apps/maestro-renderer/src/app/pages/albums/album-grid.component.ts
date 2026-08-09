import { NgClass } from '@angular/common'
import {
    afterNextRender,
    afterRenderEffect,
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

/**
 * Narrowest a tile may be before the grid drops a column, and the gap between tiles in
 * both directions.
 *
 * The only two numbers here that the CSS does not own. **The template reads them from
 * this file** — the row's track definition and both gaps are bindings — so they are a
 * single source rather than a pair kept in step by hand. Everything else about a tile's
 * box is measured off the rendered thing; see {@link TileChrome}.
 */
const MIN_TILE_WIDTH = 170
const TILE_GAP = 16

/**
 * An upper bound on the tiles one screenful of grid can hold, for the window the page
 * opens with — before there is a grid to measure.
 *
 * The page has to ask for *something* first: the grid is only created once a window has
 * landed, so it cannot be the one to size that window. Bounding it by the browser window
 * rather than by a constant is what keeps the first painted grid complete on a display of
 * any size.
 *
 * It cannot under-fill in either direction. The sidebar and the shell's own chrome only
 * make the real grid narrower than the browser window, and a real row is *taller* than
 * the square this assumes, because a tile is a cover plus a text block — so this
 * over-counts rows, which is the safe way to be wrong.
 *
 * Overscan is left out on purpose. This window is replaced by a measured one within a
 * frame or two of the grid appearing; what it has to cover is the part of it the user can
 * already see.
 */
export const initialWindowLimit = (width: number, height: number): number => {
    const columns = Math.max(1, Math.floor((width + TILE_GAP) / (MIN_TILE_WIDTH + TILE_GAP)))
    const rows = Math.max(1, Math.ceil(height / (MIN_TILE_WIDTH + TILE_GAP)))
    return columns * rows
}

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

/** How the window divides into columns, measured off the element the rows lay out in. */
interface GridMeasurement {
    columns: number
    columnWidth: number
}

/**
 * What a tile's box costs, over and above the cover inside it — **measured off a
 * rendered tile rather than restated here from its classes.**
 *
 * This is the part that used to be four constants mirroring the template: the tile's
 * padding, the gap between its cover and its text, and the height of three lines of
 * type. Every scroll offset and the canvas height are functions of them, and editing a
 * class silently made all of them wrong — the tiles overflowed their rows and nothing
 * failed. Reading them back off the thing the browser actually laid out means the
 * template is the single source for its own box, which is where it belongs.
 *
 * Both terms are invariant to the column width, which is what makes one measurement
 * enough for every geometry: the padding is fixed, and each line of text is truncated
 * rather than wrapped precisely so a narrower tile is not a taller one.
 */
interface TileChrome {
    /** Horizontal padding — the difference between a column's width and its cover's. */
    inset: number
    /** Everything in a tile's height that is not the cover: padding, gap, text. */
    height: number
}

interface GridLayout extends GridMeasurement {
    /** A tile's own height, which is the height of the row that holds one. */
    tileHeight: number
    /** A tile plus the gap beneath it — the pitch the scroll maths steps in. */
    rowHeight: number
}

/**
 * Before either measurement has landed. One column, so nothing divides by zero.
 *
 * A placeholder, not a geometry: **nothing is rendered or requested against it** except
 * the one hidden tile the grid measures itself with — see
 * {@link AlbumGridComponent.measured}.
 */
const PLACEHOLDER_MEASUREMENT: GridMeasurement = { columns: 1, columnWidth: MIN_TILE_WIDTH }

/**
 * Whether two measurements describe the same grid, so that one which changed nothing
 * is not a signal write.
 *
 * It is what keeps a resize notification that changed nothing (a height change, a
 * re-attachment, the scrollbar coming and going) from running change detection and
 * re-requesting the window it already has, once per notification, which is most of them.
 */
const sameMeasurement = (a: GridMeasurement | null, b: GridMeasurement | null): boolean =>
    a?.columns == b?.columns && a?.columnWidth == b?.columnWidth

const sameChrome = (a: TileChrome | null, b: TileChrome | null): boolean =>
    a?.inset == b?.inset && a?.height == b?.height

/** A computed length in pixels, or zero for `normal`, `auto` and anything unparseable. */
const pixels = (value: string): number => {
    const length = Number.parseFloat(value)
    return Number.isFinite(length) ? length : 0
}

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
    /**
     * The element the rows lay out in, and so the one whose width *is* the width a row
     * has to divide. Measured rather than derived from the scroller and the canvas's
     * padding, which was one more class this file had to know about.
     */
    private window = viewChild<ElementRef<HTMLElement>>('window')
    /**
     * The first rendered tile and its text block, which is what the grid measures its own
     * geometry with. Every tile carries the reference; a view query answers with the
     * first, and any of them would do — see {@link TileChrome}.
     */
    private tile = viewChild<ElementRef<HTMLElement>>('tile')
    private tileText = viewChild<ElementRef<HTMLElement>>('tileText')

    private measurement = signal<GridMeasurement | null>(null, { equal: sameMeasurement })
    private chrome = signal<TileChrome | null>(null, { equal: sameChrome })

    /**
     * Whether both measurements have landed.
     *
     * The grid is created by the shell only once the first window has landed, and it is
     * laid out before it can be measured — so its first paint would otherwise be one
     * column of full-width covers, and the first window it asked for would be one
     * screenful of a grid one column wide. Both were visible: a screen of enormous
     * covers, then a single row, then the real grid.
     *
     * So this gates **both** sides. Nothing is shown and no window is requested until the
     * grid knows its own shape. What renders in the meantime is one tile, hidden and
     * unsized — the thing {@link chrome} is read off. It costs a frame where the shell's
     * loading line just was, and buys a grid that arrives once, whole, at its final
     * geometry.
     */
    protected measured = computed(() => this.measurement() != null && this.chrome() != null)

    /**
     * The geometry every scroll calculation reads.
     *
     * A tile is its cover — a square as wide as the column, inset by the tile's own
     * padding — plus everything else in its box. Both terms come from the DOM, so this
     * file states no length the stylesheet also states.
     */
    protected layout = computed<GridLayout>(() => {
        const { columns, columnWidth } = this.measurement() ?? PLACEHOLDER_MEASUREMENT
        const chrome = this.chrome()
        const tileHeight = chrome ? columnWidth - chrome.inset + chrome.height : columnWidth

        return { columns, columnWidth, tileHeight, rowHeight: tileHeight + TILE_GAP }
    })

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

        // Until the grid has measured itself there is one hidden row of one tile, which
        // is the tile it measures. Laying out the whole window against a placeholder
        // geometry, only to throw it away a frame later, is work nobody sees.
        return this.measured() ? starts : starts.slice(0, 1)
    })

    protected columnIndices = computed(() =>
        Array.from({ length: this.layout().columns }, (_column, index) => index),
    )

    /**
     * The tile that has focus, or the keyboard destination whose window is still loading.
     *
     * A tile's own focus handler keeps ordinary click and Tab movement in step with the
     * document. A long keyboard jump writes the destination first, then
     * {@link pendingFocusIndex} carries the one exceptional interval where that tile is
     * not rendered yet.
     */
    protected focusedIndex = signal(NO_FOCUS)

    /** A keyboard destination to focus as soon as its virtual window has rendered. */
    private pendingFocusIndex = signal(NO_FOCUS)

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

            const observer = new ResizeObserver(() => this.onResize())
            observer.observe(element)
            this.destroyRef.onDestroy(() => observer.disconnect())
        })

        // Rows arriving have two DOM-side consequences a `ResizeObserver` cannot handle:
        // the first tile makes the grid measurable, and a virtual window can finally
        // contain a keyboard destination that was not rendered when its key was pressed.
        afterRenderEffect(() => {
            const rows = this.rows()
            const offset = this.offset()
            const pendingFocusIndex = this.pendingFocusIndex()
            untracked(() => {
                if (this.chrome() == null) this.onResize()
                if (
                    pendingFocusIndex != NO_FOCUS &&
                    pendingFocusIndex >= offset &&
                    pendingFocusIndex < offset + rows.length
                ) {
                    this.focusRenderedTile(pendingFocusIndex)
                }
            })
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
                this.pendingFocusIndex.set(NO_FOCUS)
                this.scroller()?.nativeElement?.scrollTo({ top: 0 })
            })
        })
    }

    /**
     * How the width divides into columns.
     *
     * The column count is what a `repeat(auto-fill, minmax(…))` would pick, computed
     * here instead because virtualisation has to know it: the row height, the canvas
     * height and every scroll-offset-to-index conversion are all functions of it, and
     * CSS will not say what it chose. The template still declares the minimum, so a
     * measurement that has not caught up yet cannot shrink the tiles past it — see the
     * track definition there.
     *
     * Read off the element the rows actually lay out in, so no padding or inset in the
     * template has to be restated here. Writing the same measurement twice is not a
     * change; {@link sameMeasurement} is what makes that true.
     *
     * **A container with no size is not a measurement.** The first `ResizeObserver`
     * delivery routinely arrives at 0×0 — that is what the observer is for — and both
     * dimensions have to be real: a width of zero says nothing about the column count,
     * and a height of zero makes the window a fraction of a screenful.
     */
    private measureGrid(): void {
        const available = this.window()?.nativeElement.clientWidth ?? 0
        const height = this.scroller()?.nativeElement.clientHeight ?? 0
        if (available <= 0 || height <= 0) return

        const columns = Math.max(1, Math.floor((available + TILE_GAP) / (MIN_TILE_WIDTH + TILE_GAP)))
        const columnWidth = (available - TILE_GAP * (columns - 1)) / columns

        this.measurement.set({ columns, columnWidth })
    }

    /**
     * Read a tile's own box back off the rendered thing — see {@link TileChrome} for why
     * this is measured rather than declared.
     *
     * The padding and the gap come from the computed style rather than from a rectangle
     * because a rectangle would answer with the height this component just *set*: the row
     * is sized from {@link layout}, and the tile fills it. The text block's height is its
     * own — flex does not stretch it vertically — which is exactly the term that used to
     * be a hand-counted constant, and the one that was wrong.
     */
    private measureTile(): void {
        const tile = this.tile()?.nativeElement
        const text = this.tileText()?.nativeElement
        if (!tile || !text) return

        const style = getComputedStyle(tile)
        const inset = pixels(style.paddingLeft) + pixels(style.paddingRight)
        const height =
            pixels(style.paddingTop) +
            pixels(style.paddingBottom) +
            pixels(style.rowGap) +
            text.getBoundingClientRect().height

        if (height <= 0) return

        this.chrome.set({ inset, height })
    }

    /**
     * Re-measure and ask for the window the scroll position means. The `ResizeObserver`
     * lands here too, because the window a scroll position means depends on the geometry
     * a resize changes — and measuring first means a scroll also re-syncs a layout that
     * somehow went stale, rather than computing a window against a column count that is
     * no longer true.
     *
     * A tile's own box does not follow the container, so a scroll does not re-read it —
     * only the resize does, which is what a zoom or a late-loading font arrives as, and
     * the first pass, which is what there is not one yet.
     *
     * The offset is always a multiple of the column count. It has to be: the loaded
     * block is positioned by whole rows, so a window starting mid-row would draw its
     * first tiles in the wrong column and shift every tile after them.
     *
     * An unmeasured grid asks for nothing. The window a scroll position means is a
     * function of the geometry, and against {@link PLACEHOLDER_MEASUREMENT} it is a guess
     * that *overwrites the one the page opened with* — the shell's own opening window is
     * a better guess than a screenful of a one-column grid, which is a handful of albums.
     */
    protected onScroll(): void {
        this.sync({ remeasureTile: false })
    }

    /** A resize is also how a zoom and a late-loading font arrive, so the tile is re-read. */
    private onResize(): void {
        this.sync({ remeasureTile: true })
    }

    private sync({ remeasureTile }: { remeasureTile: boolean }): void {
        this.measureGrid()
        if (remeasureTile || this.chrome() == null) this.measureTile()
        if (!this.measured()) return

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
        this.pendingFocusIndex.set(NO_FOCUS)
    }

    /**
     * Fade a cover up once it has decoded.
     *
     * The one place this component touches the DOM directly instead of a signal, and
     * deliberately: whether a bitmap has painted is the image element's own business,
     * not the grid's state. A signal per tile would put a change-detection run behind
     * every cover in the window — a hundred of them on the first paint, for a class the
     * element could set on itself — and would have to be evicted as tiles scroll away.
     */
    protected onCoverLoad(event: Event): void {
        ;(event.target as HTMLElement).classList.remove('opacity-0')
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
        this.pendingFocusIndex.set(index)
        this.scrollIndexIntoView(index)
        this.focusRenderedTile(index)
    }

    private focusRenderedTile(index: number): void {
        const element = document.getElementById(this.tileElementId(index))
        if (!element) return

        element.focus({ preventScroll: true })
        this.pendingFocusIndex.set(NO_FOCUS)
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
