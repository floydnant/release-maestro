import { NgClass } from '@angular/common'
import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core'
import { BandcampFan } from '@release-maestro/core'
import { HlmAvatarImports } from '@spartan-ng/helm/avatar'
import { HlmTooltip } from '@spartan-ng/helm/tooltip'

/**
 * `release` heads a feed item: larger avatars and a summary of who bought it. `track` sits at the end
 * of a track row and shows the avatars alone.
 */
export type FanAvatarStackVariant = 'release' | 'track'

/** Most discs a stack shows, counting the `+N` disc that stands in for the rest. */
const MAX_DISCS: Record<FanAvatarStackVariant, number> = { release: 5, track: 3 }

const fanList = new Intl.ListFormat('en', { style: 'long', type: 'conjunction' })

/** One letter: a second would be clipped where the next avatar overlaps this one. */
const initialOf = (name: string) => [...name.trim()][0]?.toLocaleUpperCase() ?? ''

/**
 * The fans who bought a release or a track, as overlapping profile photos. One keyboard stop whose
 * accessible name and tooltip list every fan, including those folded into the `+N` disc. A fan
 * without a photo, or whose photo fails to load, shows their initial. Where the release summary does
 * not fit beside the avatars, it wraps below them.
 */
@Component({
    selector: 'app-fan-avatar-stack',
    imports: [NgClass, HlmAvatarImports, HlmTooltip],
    changeDetection: ChangeDetectionStrategy.OnPush,
    host: { class: 'flex min-w-0' },
    // The focus ring is drawn inside the stack, above the avatars: their canvas-colored rings would
    // cover an outer ring, and the track list and text column clip anything outside the stack.
    template: `
        <span
            class="fan-avatar-stack | relative inline-flex max-w-full min-w-0 flex-wrap items-center gap-x-2 gap-y-1 outline-none focus-visible:after:pointer-events-none focus-visible:after:absolute focus-visible:after:inset-0 focus-visible:after:rounded-[inherit] focus-visible:after:ring-2 focus-visible:after:ring-border-focus focus-visible:after:ring-inset"
            [ngClass]="{ 'rounded-full': variant() === 'track', 'rounded-lg pe-2': variant() === 'release' }"
            tabindex="0"
            role="img"
            [attr.aria-label]="label()"
            [hlmTooltip]="tooltip()"
        >
            <span hlmAvatarGroup class="shrink-0">
                @for (avatar of avatars(); track avatar.fan.profileUrl) {
                    <hlm-avatar [size]="variant() === 'release' ? 'sm' : 'xs'">
                        <!-- Without a URL the image never loads, so the initial stays. -->
                        <img hlmAvatarImage [attr.src]="avatar.fan.imageUrl" alt="" />
                        <span hlmAvatarFallback>{{ avatar.initial }}</span>
                    </hlm-avatar>
                }
                @if (hiddenCount()) {
                    <span hlmAvatarGroupCount>+{{ hiddenCount() }}</span>
                }
            </span>
            @if (variant() === 'release') {
                <span class="fan-summary | truncate type-label-md text-content-secondary">{{
                    summary()
                }}</span>
            }
        </span>
    `,
})
export class FanAvatarStackComponent {
    readonly fans = input.required<BandcampFan[]>()
    readonly variant = input<FanAvatarStackVariant>('track')

    private readonly visibleCount = computed(() => {
        const max = MAX_DISCS[this.variant()]
        return this.fans().length > max ? max - 1 : this.fans().length
    })

    readonly avatars = computed(() =>
        this.fans()
            .slice(0, this.visibleCount())
            .map(fan => ({ fan, initial: initialOf(fan.name) })),
    )

    readonly hiddenCount = computed(() => this.fans().length - this.visibleCount())

    private readonly names = computed(() => fanList.format(this.fans().map(fan => fan.name)))

    /** Names one fan outright; more than one become a count that the tooltip expands. */
    readonly summary = computed(() => {
        const [only, ...others] = this.fans()
        return only && !others.length
            ? `Bought by ${only.name}`
            : `Bought by ${this.fans().length} fans you follow`
    })

    readonly label = computed(() =>
        this.variant() === 'track' || this.fans().length === 1
            ? `Bought by ${this.names()}`
            : `${this.summary()}: ${this.names()}`,
    )

    readonly tooltip = computed(() => (this.variant() === 'track' ? this.label() : this.names()))
}
