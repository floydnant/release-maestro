import { Directive } from '@angular/core'
import { classes } from '@spartan-ng/helm/utils'

/**
 * Overlaps its avatars. Each one is ringed in the canvas color so the overlap reads as a cut-out;
 * a group placed on another surface overrides the ring color.
 */
@Directive({
    selector: '[hlmAvatarGroup],hlm-avatar-group',
    host: {
        'data-slot': 'avatar-group',
    },
})
export class HlmAvatarGroup {
    constructor() {
        classes(
            () =>
                'group/avatar-group flex -space-x-2 *:data-[slot=avatar]:ring-2 *:data-[slot=avatar]:ring-background-canvas has-data-[size=sm]:-space-x-1 has-data-[size=xs]:-space-x-1',
        )
    }
}
