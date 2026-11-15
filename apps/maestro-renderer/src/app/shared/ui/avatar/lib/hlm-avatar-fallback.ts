import { Directive } from '@angular/core'
import { BrnAvatarFallback } from '@spartan-ng/brain/avatar'
import { classes } from '@spartan-ng/helm/utils'

@Directive({
    selector: '[hlmAvatarFallback]',
    exportAs: 'hlmAvatarFallback',
    hostDirectives: [BrnAvatarFallback],
    host: {
        'data-slot': 'avatar-fallback',
    },
})
export class HlmAvatarFallback {
    constructor() {
        classes(
            () =>
                'flex size-full items-center justify-center bg-background-elevated type-label-sm text-content-secondary',
        )
    }
}
