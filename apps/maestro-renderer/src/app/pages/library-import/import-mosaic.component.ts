import {
    ChangeDetectionStrategy,
    Component,
    DestroyRef,
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

/** Pace at which queued covers are placed — keeps every tile visible ≥100ms even on fast scans. */
const TICK_MS = 100
/** Fraction of the backlog drained per tick, so the mosaic catches up smoothly on huge libraries. */
const DRAIN_FACTOR = 20

/**
 * Full-bleed album-cover mosaic for the library import: covers pop in as tracks
 * are scanned, fading in (and the replaced cover fading out) on a fixed grid with
 * a hard DOM cap. Incoming covers are queued and placed at most every {@link TICK_MS}
 * per cell slot, so a too-fast scan never causes flicker. Sized via `columns`/`rows`;
 * the default 10×8 of square tiles overshoots typical window aspect ratios, so as a
 * positioned background it covers the whole window (overflow is clipped by the host).
 */
@Component({
    selector: 'app-import-mosaic',
    imports: [],
    changeDetection: ChangeDetectionStrategy.OnPush,
    host: {
        class: 'block overflow-hidden',
    },
    template: `
        <div
            class="grid gap-1.5"
            [style.grid-template-columns]="'repeat(' + columns() + ', minmax(0, 1fr))'"
        >
            @for (cell of cells(); track $index) {
                <div
                    class="relative aspect-square overflow-hidden rounded-md"
                >
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
            animation: mosaic-tile-enter 500ms var(--foundation-motion-easing-emphasized) backwards;
        }

        .mosaic-tile--leave {
            animation: mosaic-tile-leave 500ms var(--foundation-motion-easing-standard) forwards;
        }

        @keyframes mosaic-tile-enter {
            from {
                opacity: 0;
                transform: scale(0.88);
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
    columns = input(10)
    rows = input(8)

    readonly cells = signal<(MosaicCell | null)[]>([])

    private pending: LibraryAlbumPreview[] = []
    private consumedCount = 0
    /** Shuffled cell indexes so covers scatter across the whole window instead of filling row by row. */
    private placementOrder: number[] = []
    private placedCount = 0
    private revisionCounter = 0

    readonly fileUrl = fileUrl

    constructor() {
        effect(() => {
            const albums = this.albums()
            if (albums.length < this.consumedCount) this.reset()
            if (albums.length > this.consumedCount) {
                this.pending.push(...albums.slice(this.consumedCount))
                this.consumedCount = albums.length
            }
        })

        const timer = setInterval(() => this.placePendingCovers(), TICK_MS)
        inject(DestroyRef).onDestroy(() => clearInterval(timer))
    }

    tileTitle(album: LibraryAlbumPreview): string {
        return [album.artist, album.albumTitle].filter(Boolean).join(' — ')
    }

    private reset(): void {
        this.pending = []
        this.consumedCount = 0
        this.placedCount = 0
        this.placementOrder = []
        this.cells.set([])
    }

    private ensureGrid(cellCount: number): void {
        if (this.cells().length === cellCount) return
        this.placementOrder = Array.from({ length: cellCount }, (_, i) => i)
        for (let i = this.placementOrder.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1))
            ;[this.placementOrder[i], this.placementOrder[j]] = [
                this.placementOrder[j] as number,
                this.placementOrder[i] as number,
            ]
        }
        this.placedCount = 0
        this.cells.set(Array.from({ length: cellCount }, () => null))
    }

    private placePendingCovers(): void {
        if (this.pending.length === 0) return
        const cellCount = this.columns() * this.rows()
        this.ensureGrid(cellCount)
        // Adaptive drain: catch up on a backlog without ever replacing a cell
        // more than once per tick (each cover stays visible ≥ TICK_MS).
        const batchSize = Math.min(Math.ceil(this.pending.length / DRAIN_FACTOR), cellCount)
        const batch = this.pending.splice(0, batchSize)

        this.cells.update(cells => {
            const next = [...cells]
            for (const album of batch) {
                const index = this.placementOrder[this.placedCount % cellCount] as number
                this.placedCount += 1
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
