import { Directive } from '@angular/core'
import { classes, hlm } from '@spartan-ng/helm/utils'

@Directive({
    selector: 'option[hlmNativeSelectOption]',
    host: { 'data-slot': 'native-select-option' },
})
export class HlmNativeSelectOption {
    constructor() {
        classes(() => hlm('bg-[Canvas] text-[CanvasText]'))
    }
}
