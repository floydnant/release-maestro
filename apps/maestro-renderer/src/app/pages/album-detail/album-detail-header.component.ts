import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core'
import { RouterLink } from '@angular/router'
import type { AlbumDetail } from '@release-maestro/core'
import { IconComponent } from '../../shared/components/icon/icon.component'
import { fileUrl } from '../../shared/utils/file-url.util'
import { formatTotalDuration } from '../../shared/utils/formatting.utils'

/**
 * The album detail header: cover, title, and the album's own attributes.
 *
 * Presentational — an album in, links out, no service injection. It takes the domain
 * object rather than nine primitives destructured from it, per `angular-patterns`.
 *
 * **Every link out is a filtered track list**, not a detail page, because the artist
 * page (MAE-120) and the record label page do not exist yet. The link addresses the
 * right entity and works today; when those slices land, the `routerLink` here changes
 * and nothing else does.
 */
@Component({
    selector: 'app-album-detail-header',
    templateUrl: './album-detail-header.component.html',
    changeDetection: ChangeDetectionStrategy.OnPush,
    imports: [IconComponent, RouterLink],
    host: { class: 'flex shrink-0 gap-5 px-4 pb-4 pt-3' },
})
export class AlbumDetailHeaderComponent {
    album = input.required<AlbumDetail>()
    /**
     * The track count the *table* is showing, which is the one the user can count on
     * screen. `album().trackCount` is also a live count, but the detail and window
     * requests settle independently during a scan — showing the table's keeps the header
     * honest about what is actually below it.
     */
    trackCount = input.required<number>()
    trackCountLabel = input.required<string>()

    protected readonly fileUrl = fileUrl

    /**
     * The album's running time, in words rather than as a timecode — this is a sum, and
     * `1:10:30` beside a track count reads like a playhead.
     */
    protected duration = computed(() => {
        const total = this.album().totalDuration
        return total == null ? null : formatTotalDuration(total)
    })

    /**
     * The album date, preferring the full one the tag carried.
     *
     * `date` can legitimately be coarser than a day — `2019-03` — so it is shown
     * verbatim rather than parsed and reformatted, which would either invent a day or
     * fail on a value that is perfectly good. When it is absent but the year is not, the
     * year stands alone. Note that this exact difference splits an album in two on
     * ingest; see the `albumIdentityKey` caveat on the grid.
     */
    protected albumDate = computed(() => {
        const album = this.album()
        if (album.date) return album.date
        return album.year == null ? null : String(album.year)
    })
}
