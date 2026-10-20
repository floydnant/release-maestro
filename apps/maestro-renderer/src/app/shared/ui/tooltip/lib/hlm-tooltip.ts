import { Directive } from '@angular/core'
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

@Directive({
    selector: '[hlmTooltip]',
    providers: [
        provideBrnTooltipDefaultOptions({
            showDelay: 600,
            svgClasses: DEFAULT_TOOLTIP_SVG_CLASS,
            tooltipContentClasses: DEFAULT_TOOLTIP_CONTENT_CLASSES,
            arrowClasses: (position: BrnTooltipPosition) => hlm(tooltipPositionVariants({ position })),
        }),
    ],
    hostDirectives: [
        {
            directive: BrnTooltip,
            inputs: ['brnTooltip: hlmTooltip', 'position', 'hideDelay', 'showDelay', 'tooltipDisabled'],
        },
    ],
})
export class HlmTooltip {}
