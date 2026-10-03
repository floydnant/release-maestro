import { Directive, input } from '@angular/core'
import { classes, hlm } from '@spartan-ng/helm/utils'
import { HlmCardConfig, injectHlmCardConfig } from './hlm-card.token'

@Directive({
    selector: '[hlmCard],hlm-card',
    host: {
        'data-slot': 'card',
        '[attr.data-size]': 'size()',
    },
})
export class HlmCard {
    private readonly _defaultConfig = injectHlmCardConfig()
    public readonly size = input<HlmCardConfig['size']>(this._defaultConfig.size)

    constructor() {
        classes(() =>
            hlm(
                'gap-6 rounded-xl border border-border-subtle bg-background-surface text-content-primary shadow-md group/card flex flex-col',
            ),
        )
    }
}
