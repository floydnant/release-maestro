import { ChangeDetectionStrategy, Component, input } from '@angular/core'
import { BrnAvatar } from '@spartan-ng/brain/avatar'
import { classes, hlm } from '@spartan-ng/helm/utils'
import { cva, type VariantProps } from 'class-variance-authority'

// `xs` fits inside a single-line row such as a feed track; the larger sizes follow upstream.
export const avatarVariants = cva(
    'group/avatar relative flex shrink-0 overflow-hidden rounded-full bg-background-elevated select-none after:pointer-events-none after:absolute after:inset-0 after:rounded-full after:border after:border-border-subtle after:mix-blend-lighten',
    {
        variants: {
            size: {
                xs: 'size-5',
                sm: 'size-6',
                default: 'size-8',
                lg: 'size-10',
            },
        },
        defaultVariants: {
            size: 'default',
        },
    },
)

export type AvatarVariants = VariantProps<typeof avatarVariants>

/**
 * Shows its `hlmAvatarImage` once the image has loaded, and its `hlmAvatarFallback` while the image
 * is loading, absent, or failed to load.
 */
@Component({
    selector: 'hlm-avatar',
    changeDetection: ChangeDetectionStrategy.OnPush,
    host: {
        'data-slot': 'avatar',
        '[attr.data-size]': 'size()',
    },
    template: `
        @if (_image()?.canShow()) {
            <ng-content select="[hlmAvatarImage],[brnAvatarImage]" />
        } @else {
            <ng-content select="[hlmAvatarFallback],[brnAvatarFallback]" />
        }
        <ng-content />
    `,
})
export class HlmAvatar extends BrnAvatar {
    public readonly size = input<NonNullable<AvatarVariants['size']>>('default')

    constructor() {
        super()
        classes(() => hlm(avatarVariants({ size: this.size() })))
    }
}
