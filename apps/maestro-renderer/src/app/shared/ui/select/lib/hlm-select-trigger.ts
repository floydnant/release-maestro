import { IconComponent } from '../../../components/icon/icon.component'
import type { BooleanInput } from '@angular/cdk/coercion'
import { booleanAttribute, ChangeDetectionStrategy, Component, computed, input } from '@angular/core'
import { BrnFieldControlDescribedBy } from '@spartan-ng/brain/field'
import { BrnSelectTrigger } from '@spartan-ng/brain/select'
import { hlm } from '@spartan-ng/helm/utils'
import type { ClassValue } from 'clsx'

@Component({
    selector: 'hlm-select-trigger',
    imports: [IconComponent, BrnSelectTrigger, BrnFieldControlDescribedBy],
    changeDetection: ChangeDetectionStrategy.OnPush,
    template: `
        <!-- eslint-disable design-system/valid-template-classnames -- Helm merges checked base literals with caller class overrides; consumer templates are validated separately. -->
        <button
            brnSelectTrigger
            brnFieldControlDescribedBy
            [forceInvalid]="forceInvalid()"
            [id]="buttonId()"
            [class]="_computedClass()"
            [aria-invalid]="ariaInvalidInput()"
            [attr.data-size]="size()"
            data-slot="select-trigger"
        >
            <ng-content />
            <app-icon name="chevronDown" class="ms-auto size-4 text-content-muted" />
        </button>
        <!-- eslint-enable design-system/valid-template-classnames -->
    `,
})
export class HlmSelectTrigger {
    private static _id = 0

    public readonly userClass = input<ClassValue>('', { alias: 'class' })
    protected readonly _computedClass = computed(() =>
        hlm(
            'h-(--foundation-size-control-md) gap-2 rounded-lg border border-border-default bg-background-canvas px-3 py-1 type-body-md text-content-primary transition-colors duration-fast ease-standard focus-visible:ring-2 focus-visible:ring-border-focus data-[size=sm]:h-(--foundation-size-control-sm) data-[matches-spartan-invalid=true]:border-status-danger-border flex w-fit items-center justify-between whitespace-nowrap outline-none disabled:cursor-not-allowed disabled:opacity-50 *:data-[slot=select-value]:line-clamp-1 *:data-[slot=select-value]:flex *:data-[slot=select-value]:items-center [&_app-icon]:pointer-events-none [&_app-icon]:shrink-0',
            this.userClass(),
        ),
    )

    public readonly buttonId = input<string>(`hlm-select-trigger-${HlmSelectTrigger._id++}`)

    public readonly size = input<'default' | 'sm'>('default')

    /** Whether to force the trigger into an invalid state. */
    public readonly forceInvalid = input<boolean, BooleanInput>(false, { transform: booleanAttribute })

    /** Manual override for aria-invalid. When not set, auto-detects from the parent autocomplete error state. */
    public readonly ariaInvalidInput = input<boolean | undefined, BooleanInput>(undefined, {
        transform: (v: BooleanInput) => (v === '' || v === undefined ? undefined : booleanAttribute(v)),
        alias: 'aria-invalid',
    })
}
