import { Directive } from '@angular/core'
import { classes, hlm } from '@spartan-ng/helm/utils'

@Directive({
    selector: 'optgroup[hlmNativeSelectOptGroup]',
    host: { 'data-slot': 'native-select-optgroup' },
})
export class HlmNativeSelectOptGroup {
    constructor() {
        classes(() => hlm('bg-[Canvas] text-[CanvasText]'))
    }
}
