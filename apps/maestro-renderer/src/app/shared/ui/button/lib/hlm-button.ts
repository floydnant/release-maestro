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
                    'text-content-secondary pointer-hover:bg-action-quiet-hover pointer-hover:text-content-primary',
                plain: '',
                muted: 'bg-background-surface text-content-muted hover:bg-background-elevated hover:text-content-secondary',
                navigation:
                    'justify-start text-content-secondary hover:bg-action-quiet-hover hover:text-content-primary active:bg-action-quiet-pressed aria-[current=page]:bg-action-secondary aria-[current=page]:text-action-primary-content aria-[current=page]:shadow-sm aria-[current=page]:hover:bg-action-secondary-hover',
                destructive:
                    'border border-status-danger-border bg-status-danger-background text-status-danger-content hover:bg-status-danger-hover',
                link: 'shrink text-content-action underline-offset-4 hover:underline',
            },
            size: {
                default: 'rounded-lg px-3 py-1.5 type-label-md',
                none: '',
                xs: 'h-6 gap-1 rounded-md px-2 type-label-sm',
                sm: 'h-(--foundation-size-control-sm) gap-1.5 rounded-lg px-2.5 type-label-sm',
                lg: 'h-(--foundation-size-control-lg) rounded-lg px-4 type-label-md',
                icon: 'size-(--foundation-size-control-md) rounded-lg p-0',
                'icon-xs': 'size-6 rounded-lg p-0',
                'icon-sm': 'size-(--foundation-size-control-sm) rounded-lg p-0',
                'icon-lg': 'size-(--foundation-size-control-lg) rounded-lg p-0',
            },
        },
        compoundVariants: [
            {
                variant: [
                    'default',
                    'outline',
                    'secondary',
                    'ghost',
                    'muted',
                    'navigation',
                    'destructive',
                    'link',
                ],
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
        classes(() =>
            hlm([buttonVariants({ variant: this.variant(), size: this.size() }), this._additionalClasses()]),
        )
    }

    setClass(classes: string): void {
        this._additionalClasses.set(classes)
    }
}
