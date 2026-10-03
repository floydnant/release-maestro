import { Directive } from '@angular/core'
import { classes, hlm } from '@spartan-ng/helm/utils'

@Directive({
    selector: '[hlmCardContent]',
    host: { 'data-slot': 'card-content' },
})
export class HlmCardContent {
    constructor() {
        classes(() => hlm('px-6 pb-6 group-data-[size=sm]/card:px-4 group-data-[size=sm]/card:pb-4'))
    }
}
