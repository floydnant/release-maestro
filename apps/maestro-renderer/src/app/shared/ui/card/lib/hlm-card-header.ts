import { Directive } from '@angular/core'
import { classes, hlm } from '@spartan-ng/helm/utils'

@Directive({
    selector: '[hlmCardHeader],hlm-card-header',
    host: { 'data-slot': 'card-header' },
})
export class HlmCardHeader {
    constructor() {
        classes(() =>
            hlm(
                'grid gap-2 px-6 pt-6 group-data-[size=sm]/card:px-4 group-data-[size=sm]/card:pt-4 group/card-header @container/card-header grid auto-rows-min items-start has-data-[slot=card-action]:grid-cols-[1fr_auto] has-data-[slot=card-description]:grid-rows-[auto_auto]',
            ),
        )
    }
}
