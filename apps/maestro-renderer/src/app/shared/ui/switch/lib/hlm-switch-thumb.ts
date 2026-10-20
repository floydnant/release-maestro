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
        // Checked travel is the track's inner width minus the thumb: 30px - 15px, or 23px - 11px.
        classes(() =>
            hlm(
                'pointer-events-none block rounded-full bg-content-primary transition-transform duration-fast ease-standard group-data-[size=default]/switch:size-[15px] group-data-[size=sm]/switch:size-[11px] data-unchecked:translate-x-0 group-data-[size=default]/switch:data-checked:ltr:translate-x-[15px] group-data-[size=default]/switch:data-checked:rtl:translate-x-[-15px] group-data-[size=sm]/switch:data-checked:ltr:translate-x-[12px] group-data-[size=sm]/switch:data-checked:rtl:translate-x-[-12px]',
            ),
        )
    }
}
