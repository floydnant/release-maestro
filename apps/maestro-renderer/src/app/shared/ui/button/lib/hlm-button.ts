import { Directive, HostAttributeToken, inject, input, signal } from '@angular/core'
import { BrnButton } from '@spartan-ng/brain/button'
import { classes, hlm } from '@spartan-ng/helm/utils'
import { cva, type VariantProps } from 'class-variance-authority'
import type { ClassValue } from 'clsx'
import { injectBrnButtonConfig } from './hlm-button.token'

export const buttonVariants = cva(
    'no-underline transition-colors duration-fast ease-standard focus-visible:ring-2 focus-visible:ring-border-focus data-disabled:text-content-muted group/button inline-flex items-center justify-center outline-none [&_app-icon]:pointer-events-none [&_app-icon]:shrink-0',
    {
        variants: {
            variant: {
                default:
                    'bg-action-primary text-action-primary-content shadow-sm hover:bg-action-primary-hover active:bg-action-primary-pressed',
                outline:
                    'border border-border-default bg-background-canvas text-content-secondary hover:bg-background-elevated hover:text-content-primary',
                secondary:
                    'bg-action-secondary text-action-secondary-content hover:bg-action-secondary-hover active:bg-action-secondary-pressed',
                ghost: 'text-content-secondary hover:bg-action-quiet-hover hover:text-content-primary active:bg-action-quiet-pressed',
                history:
                    'text-content-secondary [&:not(:disabled):hover]:bg-action-quiet-hover [&:not(:disabled):hover]:text-content-primary',
                plain: '',
                muted: 'bg-background-surface text-content-muted hover:bg-background-elevated hover:text-content-secondary',
                navigation:
                    'justify-start text-content-secondary hover:bg-action-quiet-hover hover:text-content-primary active:bg-action-quiet-pressed aria-[current=page]:bg-action-secondary aria-[current=page]:text-action-primary-content aria-[current=page]:shadow-sm aria-[current=page]:hover:bg-action-secondary-hover',
                destructive:
                    'border border-status-danger-border bg-status-danger-background text-status-danger-content hover:bg-status-danger-hover',
                // Text links sit inline with their surrounding copy and take no button geometry.
                // Internal links read as the text they belong to until hovered. External links keep a
                // quiet standing underline, like links in imported release copy, and take the accent
                // only on hover: the one link color that signals leaving the app.
                link: 'inline shrink rounded-sm text-inherit underline-offset-2 hover:text-content-primary hover:underline',
                'external-link':
                    'inline shrink rounded-sm text-content-primary underline decoration-content-muted underline-offset-2 hover:text-content-action hover:decoration-current',
            },
            // Every single-line control (buttons, inputs, selects) shares one fixed height, so
            // controls placed side by side line up whatever their border or type. `xs` and `lg`
            // are for chrome and standalone actions that are deliberately smaller or larger.
            size: {
                default: 'h-(--foundation-size-control-sm) rounded-lg px-3 type-label-md',
                none: '',
                xs: 'h-6 gap-1 rounded-md px-2 type-label-sm',
                sm: 'h-(--foundation-size-control-sm) gap-1.5 rounded-lg px-2.5 type-label-sm',
                lg: 'h-(--foundation-size-control-md) rounded-lg px-4 type-label-md',
                icon: 'size-(--foundation-size-control-sm) rounded-lg p-0',
                'icon-xs': 'size-6 rounded-lg p-0',
                'icon-lg': 'size-(--foundation-size-control-md) rounded-lg p-0',
            },
        },
        compoundVariants: [
            {
                // Only filled controls show a disabled fill; quiet and text controls only dim.
                variant: ['default', 'outline', 'secondary', 'muted', 'destructive'],
                class: 'data-disabled:bg-action-primary-disabled',
            },
        ],
        defaultVariants: {
            variant: 'default',
            size: 'default',
        },
    },
)

export type ButtonVariants = VariantProps<typeof buttonVariants>

/** Text links inherit their surrounding typography, so they never take a button size. */
const isTextLinkVariant = (variant: ButtonVariants['variant']) =>
    variant === 'link' || variant === 'external-link'

@Directive({
    selector: 'button[hlmBtn], a[hlmBtn]',
    exportAs: 'hlmBtn',
    hostDirectives: [{ directive: BrnButton, inputs: ['disabled'] }],
    host: {
        'data-slot': 'button',
        '[attr.tabindex]': '_brnButton.disabled() ? -1 : tabindex()?.toString()',
    },
})
export class HlmButton {
    protected readonly _brnButton = inject(BrnButton)
    // Brain removes its disabled tabindex when re-enabled. Use a string on the
    // enabled path so Angular rewrites this host binding even when the caller is -1.
    public readonly tabindex = input<string | number | null>(
        inject(new HostAttributeToken('tabindex'), { optional: true }),
    )

    private readonly _config = injectBrnButtonConfig()

    private readonly _additionalClasses = signal<ClassValue>('')

    public readonly variant = input<ButtonVariants['variant']>(this._config.variant)

    public readonly size = input<ButtonVariants['size']>(this._config.size)

    constructor() {
        classes(() => {
            const variant = this.variant()
            const size = isTextLinkVariant(variant) ? 'none' : this.size()
            return hlm([buttonVariants({ variant, size }), this._additionalClasses()])
        })
    }

    setClass(classes: string): void {
        this._additionalClasses.set(classes)
    }
}
