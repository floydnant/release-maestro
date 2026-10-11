import { Directive } from '@angular/core'
import { BrnSwitchThumb } from '@spartan-ng/brain/switch'
import { classes, hlm } from '@spartan-ng/helm/utils'

@Directive({
    selector: '[hlmSwitchThumb],hlm-switch-thumb',
    hostDirectives: [BrnSwitchThumb],
    host: { 'data-slot': 'switch-thumb' },
})
export class HlmSwitchThumb {
    constructor() {
        // Checked travel is the track's inner width minus the thumb: 1.75rem - 1rem, or 1.25rem - 0.75rem.
        classes(() =>
            hlm(
                'pointer-events-none block rounded-full bg-content-primary transition-transform duration-fast ease-standard group-data-[size=default]/switch:size-4 group-data-[size=sm]/switch:size-3 data-unchecked:translate-x-0 group-data-[size=default]/switch:data-checked:ltr:translate-x-3 group-data-[size=default]/switch:data-checked:rtl:-translate-x-3 group-data-[size=sm]/switch:data-checked:ltr:translate-x-2 group-data-[size=sm]/switch:data-checked:rtl:-translate-x-2',
            ),
        )
    }
}
