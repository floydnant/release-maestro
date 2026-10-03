import { CdkMenu } from '@angular/cdk/menu'
import { Directive, ElementRef, inject, signal } from '@angular/core'
import { toSignal } from '@angular/core/rxjs-interop'
import { deriveMenuSideFromTransformOrigin, MENU_SIDE, type MenuSide } from '@spartan-ng/brain/core'
import { classes, hlm } from '@spartan-ng/helm/utils'
import { map } from 'rxjs'

@Directive({
    selector: '[hlmDropdownMenuSub],hlm-dropdown-menu-sub',
    hostDirectives: [CdkMenu],
    host: {
        'data-slot': 'dropdown-menu-sub',
        '[attr.data-state]': '_state()',
        '[attr.data-side]': '_side()',
    },
})
export class HlmDropdownMenuSub {
    private readonly _host = inject(CdkMenu)
    private readonly _elementRef = inject(ElementRef<HTMLElement>)
    // The sub-trigger provides its configured side; CDK parents this content's injector under it.
    private readonly _menuSide = inject(MENU_SIDE, { optional: true })

    protected readonly _state = toSignal(this._host.closed.pipe(map((): 'open' | 'closed' => 'closed')), {
        initialValue: 'open',
    })
    protected readonly _side = signal<MenuSide>(this._menuSide?.side() ?? 'right')

    constructor() {
        this.setSideFromTransformOrigin()

        classes(() =>
            hlm(
                'min-w-32 rounded-lg border border-border-default bg-background-elevated p-1 text-content-primary shadow-lg type-body-sm w-auto',
            ),
        )
    }

    private setSideFromTransformOrigin() {
        const side = this._menuSide?.side() ?? 'right'
        // CDK sets transform-origin on this element synchronously on attach; read it next tick and derive side
        setTimeout(() => {
            this._side.set(
                deriveMenuSideFromTransformOrigin(this._elementRef.nativeElement.style.transformOrigin, side),
            )
        })
    }
}
