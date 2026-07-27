import {
    ChangeDetectionStrategy,
    Component,
    DestroyRef,
    ElementRef,
    effect,
    inject,
    input,
    signal,
} from '@angular/core'
import { LibraryAlbumPreview } from '@release-maestro/core'
import { fileUrl } from '../../shared/utils/file-url.util'

interface MosaicCell {
    current: LibraryAlbumPreview
    /** The cover being replaced; kept one revision for its fade-out animation. */
    previous: LibraryAlbumPreview | null
    /** Bumped on every replacement so the template re-creates the img nodes (restarts animations). */
    revision: number
}

/** Cadence at which covers are placed/refreshed. */
const TICK_MS = 140
/** Desired tile edge length, in px; the grid picks the column/row count nearest to this. */
const TARGET_TILE_PX = 150
/** Empty cells filled per tick — a brisk but steady build-up of the wall. */
const FILL_PER_TICK = 5
/** Filled cells refreshed per tick once the wall is full — a lively, non-hectic shimmer. */
const CHURN_PER_TICK = 3
/** Upper bound on the queued backlog, so completion never triggers a catch-up burst. */
const MAX_PENDING = 24

/**
 * Full-bleed album-cover mosaic for the library import: covers pop in as tracks
 * are scanned, fading in (and the replaced cover fading out).
 *
 * The grid is responsive — columns/rows are derived from the host size so tiles
 * stay near {@link TARGET_TILE_PX} and cover the whole window at any aspect ratio.
 * Covers are queued and placed at a *constant* rate (independent of how far the
 * scan is ahead), so pacing never speeds up under a backlog nor bursts at the end.
 * Empty cells fill first ({@link FILL_PER_TICK}); once full the wall shimmers
 * gently ({@link CHURN_PER_TICK}). When `active` goes false (scan finished) the
 * wall finishes filling any gaps and then settles instead of churning forever.
 */
@Component({
    selector: 'app-import-mosaic',
    imports: [],
    changeDetection: ChangeDetectionStrategy.OnPush,
    host: {
        class: 'block size-full overflow-hidden',
        'data-testid': 'import-mosaic',
    },
    template: `
        <div
            class="grid size-full gap-1.5"
            [style.grid-template-columns]="'repeat(' + cols() + ', minmax(0, 1fr))'"
            [style.grid-template-rows]="'repeat(' + rows() + ', minmax(0, 1fr))'"
        >
            @for (cell of cells(); track $index) {
                <div class="mosaic-cell relative overflow-hidden rounded-md" data-testid="import-mosaic-cell">
                    @if (cell) {
                        <!-- Tracking by revision recreates the nodes on replacement, restarting the animations. -->
                        @for (revisionCell of [cell]; track revisionCell.revision) {
                            @if (revisionCell.previous; as previous) {
                                <img
                                    class="mosaic-tile mosaic-tile--leave"
                                    [src]="fileUrl(previous.coverPath)"
                                    alt=""
                                />
                            }
                            <img
                                class="mosaic-tile mosaic-tile--enter"
                                [src]="fileUrl(revisionCell.current.coverPath)"
                                [title]="tileTitle(revisionCell.current)"
                                alt=""
                            />
                        }
                    }
                </div>
            }
        </div>
    `,
    styles: `
        .mosaic-tile {
            position: absolute;
            inset: 0;
            height: 100%;
            width: 100%;
            object-fit: cover;
        }

        .mosaic-tile--enter {
            animation: mosaic-tile-enter 650ms var(--foundation-motion-easing-emphasized) backwards;
        }

        .mosaic-tile--leave {
            animation: mosaic-tile-leave 650ms var(--foundation-motion-easing-standard) forwards;
        }

        @keyframes mosaic-tile-enter {
            from {
                opacity: 0;
                transform: scale(0.92);
            }
            to {
                opacity: 1;
                transform: scale(1);
            }
        }

        @keyframes mosaic-tile-leave {
            from {
                opacity: 1;
            }
            to {
                opacity: 0;
            }
        }

        @media (prefers-reduced-motion: reduce) {
            .mosaic-tile--enter {
                animation: none;
            }
            .mosaic-tile--leave {
                animation: none;
                opacity: 0;
            }
        }
    `,
})
export class ImportMosaicComponent {
    /** Cumulative album previews in arrival order (append-only; shrinks only on a new scan). */
    albums = input.required<LibraryAlbumPreview[]>()
    /** While false (scan reached a terminal state) the wall settles instead of churning. */
    active = input(true)

    readonly cols = signal(1)
    readonly rows = signal(1)
    readonly cells = signal<(MosaicCell | null)[]>([])

    private readonly host = inject<ElementRef<HTMLElement>>(ElementRef)
    private pending: LibraryAlbumPreview[] = []
    private consumedCount = 0
    private revisionCounter = 0

    readonly fileUrl = fileUrl

    constructor() {
        // Ingest newly arrived albums into a bounded backlog.
        effect(() => {
            const albums = this.albums()
            if (albums.length < this.consumedCount) this.resetQueue()
            if (albums.length > this.consumedCount) {
                this.pending.push(...albums.slice(this.consumedCount))
                this.consumedCount = albums.length
                if (this.pending.length > MAX_PENDING) this.pending = this.pending.slice(-MAX_PENDING)
            }
        })

        const resizeObserver = new ResizeObserver(() => this.measure())
        resizeObserver.observe(this.host.nativeElement)
        this.measure()

        const timer = setInterval(() => this.tick(), TICK_MS)
        inject(DestroyRef).onDestroy(() => {
            clearInterval(timer)
            resizeObserver.disconnect()
        })
    }

    tileTitle(album: LibraryAlbumPreview): string {
        return [album.artist, album.albumTitle].filter(Boolean).join(' — ')
    }

    /** Recompute the column/row count from the host size, preserving placed covers. */
    private measure(): void {
        const element = this.host.nativeElement
        const width = element.clientWidth
        const height = element.clientHeight
        if (width === 0 || height === 0) return
        const cols = Math.max(1, Math.round(width / TARGET_TILE_PX))
        const rows = Math.max(1, Math.round(height / TARGET_TILE_PX))
        if (cols === this.cols() && rows === this.rows()) return
        this.cols.set(cols)
        this.rows.set(rows)
        this.resizeGrid(cols * rows)
    }

    private resizeGrid(cellCount: number): void {
        this.cells.update(cells => {
            if (cells.length === cellCount) return cells
            const next = cells.slice(0, cellCount)
            while (next.length < cellCount) next.push(null)
            return next
        })
    }

    private resetQueue(): void {
        this.pending = []
        this.consumedCount = 0
        this.cells.set(Array.from({ length: this.cols() * this.rows() }, () => null))
    }

    private tick(): void {
        if (this.pending.length === 0) return
        const cells = this.cells()
        const empties: number[] = []
        for (let i = 0; i < cells.length; i++) if (!cells[i]) empties.push(i)

        let targets: number[]
        if (empties.length > 0) {
            // Fill gaps first — a satisfying build-up.
            targets = pickRandom(empties, Math.min(FILL_PER_TICK, empties.length, this.pending.length))
        } else if (this.active()) {
            // Full wall, still scanning: refresh a few random tiles.
            targets = pickRandom(range(cells.length), Math.min(CHURN_PER_TICK, this.pending.length))
        } else {
            // Full wall and the scan is done: settle.
            return
        }
        if (targets.length === 0) return

        this.cells.update(current => {
            const next = [...current]
            for (const index of targets) {
                const album = this.pending.shift()
                if (!album) break
                next[index] = {
                    current: album,
                    previous: next[index]?.current ?? null,
                    revision: ++this.revisionCounter,
                }
            }
            return next
        })
    }
}

/** Pick up to `count` distinct random elements from `items`. */
const pickRandom = <T>(items: T[], count: number): T[] => {
    const pool = [...items]
    const picked: T[] = []
    for (let i = 0; i < count && pool.length > 0; i++) {
        const index = Math.floor(Math.random() * pool.length)
        picked.push(pool[index] as T)
        pool.splice(index, 1)
    }
    return picked
}

const range = (length: number): number[] => Array.from({ length }, (_, index) => index)
