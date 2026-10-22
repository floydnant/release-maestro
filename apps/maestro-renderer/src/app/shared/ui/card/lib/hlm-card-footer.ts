import { Directive } from '@angular/core'
import { classes, hlm } from '@spartan-ng/helm/utils'

@Directive({
    selector: '[hlmCardFooter],hlm-card-footer',
    host: { 'data-slot': 'card-footer' },
})
export class HlmCardFooter {
    constructor() {
        classes(() =>
            hlm(
                'flex items-center gap-2 px-6 pb-6 group-data-[size=sm]/card:px-4 group-data-[size=sm]/card:pb-4 flex items-center',
            ),
        )
    }
}
