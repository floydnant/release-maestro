import type { BooleanInput } from '@angular/cdk/coercion'
import {
    booleanAttribute,
    ChangeDetectionStrategy,
    Component,
    computed,
    forwardRef,
    input,
    linkedSignal,
    output,
    viewChild,
} from '@angular/core'
import { type ControlValueAccessor, NG_VALUE_ACCESSOR } from '@angular/forms'
import type { ChangeFn, TouchFn } from '@spartan-ng/brain/forms'
import { BrnSwitch, type BrnSwitchSize } from '@spartan-ng/brain/switch'
import { hlm } from '@spartan-ng/helm/utils'
import type { ClassValue } from 'clsx'
import { HlmSwitchThumb } from './hlm-switch-thumb'

export const HLM_SWITCH_VALUE_ACCESSOR = {
    provide: NG_VALUE_ACCESSOR,
    useExisting: forwardRef(() => HlmSwitch),
    multi: true,
}

@Component({
    selector: 'hlm-switch',
    imports: [BrnSwitch, HlmSwitchThumb],
    providers: [HLM_SWITCH_VALUE_ACCESSOR],
    changeDetection: ChangeDetectionStrategy.OnPush,
    host: {
        'data-slot': 'switch',
        class: 'contents',
        '[attr.aria-label]': 'null',
        '[attr.aria-labelledby]': 'null',
        '[attr.aria-describedby]': 'null',
    },
    template: `
        <!-- eslint-disable design-system/valid-template-classnames -- Helm merges checked base literals with caller class overrides; consumer templates are validated separately. -->
        <brn-switch
            [class]="_computedClass()"
            [size]="size()"
            [checked]="checked()"
            [disabled]="_disabled()"
            [id]="inputId()"
            [forceInvalid]="forceInvalid()"
            [aria-label]="ariaLabel()"
            [aria-labelledby]="ariaLabelledby()"
            [aria-describedby]="ariaDescribedby()"
            (checkedChange)="handleChange($event)"
            (touched)="_onTouched?.()"
        >
            <hlm-switch-thumb />
        </brn-switch>
        <!-- eslint-enable design-system/valid-template-classnames -->
    `,
})
export class HlmSwitch implements ControlValueAccessor {
    private readonly _brnSwitch = viewChild.required(BrnSwitch)

    public readonly userClass = input<ClassValue>('', { alias: 'class' })
    // Padding insets the thumb in rem, like the track and thumb sizes, so travel stays exact at the
    // app's root font size.
    protected readonly _computedClass = computed(() =>
        hlm(
            'group/switch inline-flex shrink-0 items-center rounded-full p-0.5 outline-none transition-colors duration-fast ease-standard focus-visible:ring-2 focus-visible:ring-border-focus data-checked:bg-action-primary data-unchecked:bg-border-default data-[matches-spartan-invalid=true]:ring-2 data-[matches-spartan-invalid=true]:ring-status-danger-border data-disabled:cursor-not-allowed data-disabled:opacity-50 data-[size=default]:h-5 data-[size=default]:w-8 data-[size=sm]:h-4 data-[size=sm]:w-6',
            this.userClass(),
        ),
    )

    /** The checked state of the switch. */
    public readonly checkedInput = input<boolean, BooleanInput>(false, {
        alias: 'checked',
        transform: booleanAttribute,
    })
    public readonly checked = linkedSignal(this.checkedInput)

    /** Emits when the checked state of the switch changes. */
    public readonly checkedChange = output<boolean>()

    /** The disabled state of the switch. */
    public readonly disabled = input<boolean, BooleanInput>(false, {
        transform: booleanAttribute,
    })

    /** The size of the switch. */
    public readonly size = input<BrnSwitchSize>('default')

    /** Used to set the id on the underlying brn element. */
    public readonly inputId = input<string | null>(null)

    /** Whether to force the input into an invalid state. */
    public readonly forceInvalid = input<boolean, BooleanInput>(false, { transform: booleanAttribute })

    /** Used to set the aria-label attribute on the underlying brn element. */
    public readonly ariaLabel = input<string | null>(null, { alias: 'aria-label' })

    /** Used to set the aria-labelledby attribute on the underlying brn element. */
    public readonly ariaLabelledby = input<string | null>(null, { alias: 'aria-labelledby' })

    /** Used to set the aria-describedby attribute on the underlying brn element. */
    public readonly ariaDescribedby = input<string | null>(null, { alias: 'aria-describedby' })

    protected readonly _disabled = linkedSignal(this.disabled)

    protected _onChange?: ChangeFn<boolean>
    protected _onTouched?: TouchFn

    /** Moves focus to the switch button, for example to restore it after a save. */
    public focus(options?: FocusOptions): void {
        this._brnSwitch().switch().nativeElement.focus(options)
    }

    protected handleChange(value: boolean): void {
        this.checked.set(value)
        this._onChange?.(value)
        this.checkedChange.emit(value)
    }

    /** CONTROL VALUE ACCESSOR */
    writeValue(value: boolean): void {
        this.checked.set(Boolean(value))
    }

    registerOnChange(fn: ChangeFn<boolean>): void {
        this._onChange = fn
    }

    registerOnTouched(fn: TouchFn): void {
        this._onTouched = fn
    }

    setDisabledState(isDisabled: boolean): void {
        this._disabled.set(isDisabled)
    }
}
