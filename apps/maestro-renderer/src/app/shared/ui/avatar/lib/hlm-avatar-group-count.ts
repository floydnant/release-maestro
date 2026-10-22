import { Directive } from '@angular/core'
import { classes } from '@spartan-ng/helm/utils'

/** The `+N` disc after a group's visible avatars. It widens into a pill for longer counts. */
@Directive({
    selector: '[hlmAvatarGroupCount],hlm-avatar-group-count',
    host: {
        'data-slot': 'avatar-group-count',
    },
})
export class HlmAvatarGroupCount {
    constructor() {
        classes(
            () =>
                'relative flex h-8 min-w-8 shrink-0 items-center justify-center rounded-full bg-background-elevated px-1 type-label-sm text-content-secondary ring-2 ring-background-canvas group-has-data-[size=lg]/avatar-group:h-10 group-has-data-[size=lg]/avatar-group:min-w-10 group-has-data-[size=sm]/avatar-group:h-6 group-has-data-[size=sm]/avatar-group:min-w-6 group-has-data-[size=xs]/avatar-group:h-5 group-has-data-[size=xs]/avatar-group:min-w-5',
        )
    }
}
