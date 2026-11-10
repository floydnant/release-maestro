import { NgTemplateOutlet } from '@angular/common'
import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core'
import { BandcampFan } from '@release-maestro/core'
import { HlmAvatarImports } from '@spartan-ng/helm/avatar'
import { HlmButton } from '@spartan-ng/helm/button'
import { HlmTooltip } from '@spartan-ng/helm/tooltip'

/**
 * `release` heads a feed item: larger avatars and a sentence naming who bought it, each name a link
 * to that fan's Bandcamp profile. `track` sits at the end of a track row and shows the avatars alone.
 */
export type FanAvatarStackVariant = 'release' | 'track'

/** Most discs a stack shows, counting the `+N` disc that stands in for the rest. */
const MAX_DISCS: Record<FanAvatarStackVariant, number> = { release: 5, track: 3 }

const fanList = new Intl.ListFormat('en', { style: 'long', type: 'conjunction' })

/** One letter: a second would be clipped where the next avatar overlaps this one. */
const initialOf = (name: string) => [...name.trim()][0]?.toLocaleUpperCase() ?? ''

/** A run of the buyer sentence: a fan to link, or the separator text between two fans. */
type BuyerPart = { fan: BandcampFan; text?: never } | { fan?: never; text: string }

/**
 * The fans who bought a release or a track, as overlapping profile photos. A fan without a photo, or
 * whose photo fails to load, shows their initial.
 *
 * On a track the stack is one keyboard stop whose accessible name and tooltip list every fan,
 * including those folded into the `+N` disc. On a release the avatars are decorative and every fan
 * is named in the sentence beside them as a link to their profile, so the links are the keyboard
 * stops. Where that sentence does not fit beside the avatars, it wraps below them.
 */
@Component({
    selector: 'app-fan-avatar-stack',
    imports: [NgTemplateOutlet, HlmAvatarImports, HlmButton, HlmTooltip],
    changeDetection: ChangeDetectionStrategy.OnPush,
    host: { class: 'flex min-w-0' },
    // The track focus ring is drawn inside the stack, above the avatars: their canvas-colored rings
    // would cover an outer ring, and the track list clips anything outside the stack.
    template: `
        <ng-template #avatarGroup>
            <!-- The release sentence names every fan, so its avatars only decorate it. -->
            <span hlmAvatarGroup class="shrink-0" [attr.aria-hidden]="variant() === 'release' || null">
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
        </ng-template>

        @if (variant() === 'release') {
            <p class="fan-avatar-stack | flex max-w-full min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
                <ng-container [ngTemplateOutlet]="avatarGroup" />
                <!-- No source whitespace between the sentence's parts: wherever whitespace is preserved it
                     would render as a space before each comma. Line breaks sit inside tags only. -->
                <!-- prettier-ignore -->
                <span
                    class="fan-summary | min-w-0 type-label-md wrap-break-word text-content-secondary"
                >Bought by @for (part of buyerParts(); track $index) {@if (part.fan; as fan) {<a
                    hlmBtn
                    variant="external-link"
                    class="fan-link | focus-visible:ring-inset"
                    [href]="fan.profileUrl"
                    target="_blank"
                    rel="noopener noreferrer"
                >{{ fan.name }}</a>} @else {<ng-container>{{ part.text }}</ng-container>}}</span>
            </p>
        } @else {
            <span
                class="fan-avatar-stack | relative inline-flex max-w-full min-w-0 items-center rounded-full outline-none focus-visible:after:pointer-events-none focus-visible:after:absolute focus-visible:after:inset-0 focus-visible:after:rounded-[inherit] focus-visible:after:ring-2 focus-visible:after:ring-border-focus focus-visible:after:ring-inset"
                tabindex="0"
                role="img"
                [attr.aria-label]="label()"
                [hlmTooltip]="label()"
            >
                <ng-container [ngTemplateOutlet]="avatarGroup" />
            </span>
        }
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

    /** Every fan in a sentence-ready list: `Ada, Ben, and Cy`, with each name kept as its fan. */
    readonly buyerParts = computed((): BuyerPart[] => {
        const fans = this.fans()
        let next = 0
        return fanList.formatToParts(fans.map(fan => fan.name)).flatMap((part): BuyerPart[] => {
            if (part.type === 'literal') return [{ text: part.value }]
            const fan = fans[next++]
            return fan ? [{ fan }] : []
        })
    })

    readonly label = computed(() => `Bought by ${fanList.format(this.fans().map(fan => fan.name))}`)
}
