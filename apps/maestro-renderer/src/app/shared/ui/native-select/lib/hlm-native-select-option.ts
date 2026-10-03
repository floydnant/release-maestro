import { Directive } from '@angular/core'

@Directive({
    selector: 'option[hlmNativeSelectOption]',
    host: { 'data-slot': 'native-select-option' },
})
export class HlmNativeSelectOption {}
