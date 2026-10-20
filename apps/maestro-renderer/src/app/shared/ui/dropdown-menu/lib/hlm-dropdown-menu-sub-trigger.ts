import { CdkMenuTrigger } from '@angular/cdk/menu'
import type { ConnectedPosition } from '@angular/cdk/overlay'
import { Directive, ElementRef, forwardRef, inject, input } from '@angular/core'
import { takeUntilDestroyed } from '@angular/core/rxjs-interop'
import { createMenuPosition, MENU_SIDE, type MenuAlign, type MenuSide } from '@spartan-ng/brain/core'
import { classes, hlm } from '@spartan-ng/helm/utils'

type MenuInset = { start: number; end: number; top: number; bottom: number }

const oppositeAlign = { start: 'end', end: 'start', center: 'center' } as const satisfies Record<
    MenuAlign,
    MenuAlign
>

/**
 * Opens beside the parent menu, flipping to the other side and the other vertical edge when the
 * viewport is too small. Offsets clear the parent menu's padding and border so the submenu never
 * covers it, and line up the submenu's first item with the trigger.
 */
function submenuPositions(align: MenuAlign, side: MenuSide, inset: MenuInset): ConnectedPosition[] {
    if (side === 'top' || side === 'bottom') return createMenuPosition(align, side)
    const positions = [
        ...createMenuPosition(align, side),
        ...(align === 'center' ? [] : createMenuPosition(oppositeAlign[align], side)),
    ]
    return positions.map(position => ({
        ...position,
        offsetX: position.overlayX === 'start' ? inset.end : -inset.start,
        offsetY: position.overlayY === 'top' ? -inset.top : position.overlayY === 'bottom' ? inset.bottom : 0,
    }))
}

@Directive({
    selector: '[hlmDropdownMenuSubTrigger]',
    providers: [{ provide: MENU_SIDE, useExisting: forwardRef(() => HlmDropdownMenuSubTrigger) }],
    hostDirectives: [
        {
            directive: CdkMenuTrigger,
            inputs: [
                'cdkMenuTriggerFor: hlmDropdownMenuSubTrigger',
                'cdkMenuTriggerData: hlmDropdownMenuTriggerData',
            ],
            outputs: ['cdkMenuOpened: hlmDropdownMenuSubOpened', 'cdkMenuClosed: hlmDropdownMenuSubClosed'],
        },
    ],
    host: { 'data-slot': 'dropdown-menu-sub-trigger' },
})
export class HlmDropdownMenuSubTrigger {
    private readonly _cdkTrigger = inject(CdkMenuTrigger, { host: true })
    private readonly _host = inject<ElementRef<HTMLElement>>(ElementRef)

    public readonly align = input<MenuAlign>('start')
    // A submenu opens beside its parent; the menu config's side is for the top-level menu.
    public readonly side = input<MenuSide>('right')

    constructor() {
        // CDK sets transform-origin on the submenu content from the resolved position; the content reads it
        // to animate from the anchored corner and to derive its data-side. Cast tolerates @angular/cdk < 21.2
        // (we still support >=21.0), where the property is absent and the assignment is a harmless no-op.
        ;(this._cdkTrigger as { transformOriginSelector?: string }).transformOriginSelector =
            '[data-slot="dropdown-menu-sub"]'

        // CDK emits `opened` synchronously just before it creates the overlay from `menuPosition`.
        // Measure the parent menu then: it is laid out by the time the user opens a submenu. A
        // measurement taken earlier can reach CDK too late and leave the submenu over its parent.
        this._cdkTrigger.opened.pipe(takeUntilDestroyed()).subscribe(() => {
            this._cdkTrigger.menuPosition = submenuPositions(
                this.align(),
                this.side(),
                this.measureParentInset(),
            )
        })

        classes(() => hlm('aria-expanded:bg-action-quiet-hover aria-expanded:text-content-primary'))
    }

    private measureParentInset(): MenuInset {
        const item = this._host.nativeElement
        const menu = item.closest('[data-slot="dropdown-menu"], [data-slot="dropdown-menu-sub"]')
        if (!menu) return { start: 0, end: 0, top: 0, bottom: 0 }
        const itemBox = item.getBoundingClientRect()
        const menuBox = menu.getBoundingClientRect()
        // The submenu shares the parent's padding and border, so they also offset its first item.
        const style = getComputedStyle(menu)
        return {
            start: itemBox.left - menuBox.left,
            end: menuBox.right - itemBox.right,
            top: parseFloat(style.paddingTop) + parseFloat(style.borderTopWidth),
            bottom: parseFloat(style.paddingBottom) + parseFloat(style.borderBottomWidth),
        }
    }
}
