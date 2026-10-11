import { afterNextRender, Directive, ElementRef, inject, Injector } from '@angular/core'
import { BrnTooltip, BrnTooltipPosition, provideBrnTooltipDefaultOptions } from '@spartan-ng/brain/tooltip'
import { hlm } from '@spartan-ng/helm/utils'
import { cva } from 'class-variance-authority'

export const DEFAULT_TOOLTIP_SVG_CLASS =
    'bg-background-elevated fill-background-elevated z-50 block size-2.5 translate-y-[calc(-50%-2px)] rotate-45 rounded-sm'

export const DEFAULT_TOOLTIP_CONTENT_CLASSES = hlm(
    'rounded-lg border border-border-default px-3 py-1.5 type-body-sm shadow-lg duration-fast ease-standard bg-background-elevated text-content-primary data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95 data-[state=delayed-open]:animate-in data-[state=delayed-open]:fade-in-0 data-[state=delayed-open]:zoom-in-95 data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-95 data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2 z-50 w-fit max-w-[min(24rem,calc(100vw-1rem))] origin-(--radix-tooltip-content-transform-origin) text-balance whitespace-normal wrap-anywhere',
)

export const tooltipPositionVariants = cva('absolute', {
    variants: {
        position: {
            top: 'bottom-0 left-[calc(50%-5px)] translate-y-full',
            bottom: '-top-2.5 left-[calc(50%-5px)] translate-y-0 rotate-180',
            left: '-inset-e-2.5 top-[calc(50%-5px)] translate-y-0 rotate-270 rtl:-rotate-270',
            right: '-inset-s-2.5 top-[calc(50%-5px)] translate-y-0 rotate-90 rtl:-rotate-90',
        },
    },
})

const tooltipDefaults = provideBrnTooltipDefaultOptions({
    showDelay: 600,
    svgClasses: DEFAULT_TOOLTIP_SVG_CLASS,
    tooltipContentClasses: DEFAULT_TOOLTIP_CONTENT_CLASSES,
    arrowClasses: (position: BrnTooltipPosition) => hlm(tooltipPositionVariants({ position })),
})

const normalize = (text: string | null | undefined) => (text ?? '').replace(/\s+/g, ' ').trim().toLowerCase()

/**
 * Brain points the trigger's `aria-describedby` at the tooltip once it shows. Remove that link when
 * `isRedundant` says the tooltip adds nothing to the trigger's own name, so assistive technology does
 * not read the same words twice. Brain sets the attribute from an effect during the render that
 * follows `show`, so the removal waits for that render.
 */
function dropRedundantDescription(isRedundant: (tooltip: BrnTooltip, host: HTMLElement) => boolean) {
    const tooltip = inject(BrnTooltip)
    const host: HTMLElement = inject(ElementRef).nativeElement
    const injector = inject(Injector)
    tooltip.show.subscribe(() => {
        afterNextRender(
            () => {
                if (isRedundant(tooltip, host)) host.removeAttribute('aria-describedby')
            },
            { injector },
        )
    })
    return tooltip
}

/**
 * A tooltip that labels or explains its trigger, typically an icon-only control. When the trigger's
 * accessible name already contains the tooltip's words, it is shown but not announced again.
 */
@Directive({
    selector: '[hlmTooltip]',
    providers: [tooltipDefaults],
    hostDirectives: [
        {
            directive: BrnTooltip,
            inputs: ['brnTooltip: hlmTooltip', 'position', 'hideDelay', 'showDelay', 'tooltipDisabled'],
        },
    ],
})
export class HlmTooltip {
    constructor() {
        dropRedundantDescription((tooltip, host) => {
            const text = tooltip.brnTooltip()
            if (typeof text !== 'string') return false
            const name = host.getAttribute('aria-label') ?? host.textContent
            return normalize(name).includes(normalize(text))
        })
    }
}

/** Whether the element, or anything inside it, clips its content — a `truncate` that is cutting text. */
function isClippingContent(element: Element): boolean {
    for (const candidate of [element, ...element.querySelectorAll('*')]) {
        const overflowsX = candidate.scrollWidth > candidate.clientWidth
        const overflowsY = candidate.scrollHeight > candidate.clientHeight
        if (!overflowsX && !overflowsY) continue
        const style = getComputedStyle(candidate)
        if ((overflowsX && style.overflowX !== 'visible') || (overflowsY && style.overflowY !== 'visible')) {
            return true
        }
    }
    return false
}

/**
 * Reveals text that is cut off by truncation. Shows only while the host or one of its descendants
 * is actually clipping, measured when the pointer enters or focus arrives, so fully visible text
 * never gets a tooltip that repeats it. The text is already in the accessibility tree, so the
 * tooltip is never announced as a description.
 */
@Directive({
    selector: '[hlmOverflowTooltip]',
    providers: [tooltipDefaults],
    hostDirectives: [{ directive: BrnTooltip, inputs: ['brnTooltip: hlmOverflowTooltip', 'position'] }],
    host: {
        '(pointerenter)': 'syncToOverflow()',
        '(focus)': 'syncToOverflow()',
    },
})
export class HlmOverflowTooltip {
    private readonly _tooltip = dropRedundantDescription(() => true)
    private readonly _host: HTMLElement = inject(ElementRef).nativeElement

    /** Runs before Brain's own trigger listeners, which check the disabled state when the delay ends. */
    protected syncToOverflow() {
        this._tooltip.mutableTooltipDisabled.set(!isClippingContent(this._host))
    }
}
