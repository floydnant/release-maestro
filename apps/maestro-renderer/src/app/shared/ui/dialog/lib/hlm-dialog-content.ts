import { IconComponent } from '../../../components/icon/icon.component'
import type { BooleanInput } from '@angular/cdk/coercion'
import type { ComponentType } from '@angular/cdk/portal'
import { NgComponentOutlet, NgTemplateOutlet } from '@angular/common'
import {
    booleanAttribute,
    ChangeDetectionStrategy,
    Component,
    computed,
    inject,
    input,
    TemplateRef,
} from '@angular/core'
import { BrnDialogRef, injectBrnDialogContext } from '@spartan-ng/brain/dialog'
import { HlmButton } from '@spartan-ng/helm/button'

import { classes, hlm } from '@spartan-ng/helm/utils'
import { HlmDialogClose } from './hlm-dialog-close'

type HlmDialogContentContext = {
    $component?: ComponentType<unknown> | TemplateRef<unknown>
    $dynamicComponentClass?: string
    $showCloseButton?: boolean
    $closeLabel?: string
}

@Component({
    selector: 'hlm-dialog-content',
    imports: [NgComponentOutlet, NgTemplateOutlet, HlmButton, HlmDialogClose, IconComponent],
    changeDetection: ChangeDetectionStrategy.OnPush,
    host: {
        'data-slot': 'dialog-content',
        '[attr.data-state]': 'state()',
    },
    template: `
        @if (template) {
            <ng-container [ngTemplateOutlet]="template" [ngTemplateOutletContext]="templateContext" />
        } @else if (component) {
            <ng-container [ngComponentOutlet]="component" />
        } @else {
            <ng-content />
        }

        @if (showCloseButton()) {
            <button hlmBtn variant="ghost" size="icon-sm" class="absolute inset-e-3 top-3" hlmDialogClose>
                <span class="sr-only">{{ closeLabel() }}</span>
                <app-icon name="close" />
            </button>
        }
    `,
})
export class HlmDialogContent {
    private readonly _dialogRef = inject(BrnDialogRef)
    private readonly _dialogContext = injectBrnDialogContext<HlmDialogContentContext | null>({
        optional: true,
    })

    public readonly showCloseButton = input<boolean, BooleanInput>(
        this._dialogContext?.$showCloseButton ?? true,
        {
            transform: booleanAttribute,
        },
    )
    public readonly closeLabel = input<string>(this._dialogContext?.$closeLabel ?? 'Close')

    public readonly state = computed(() => this._dialogRef?.state() ?? 'closed')

    private readonly _content = this._dialogContext?.$component
    public readonly template = this._content instanceof TemplateRef ? this._content : undefined
    public readonly component = this._content instanceof TemplateRef ? undefined : this._content
    public readonly templateContext = { $implicit: this._dialogContext }
    private readonly _dynamicComponentClass = this._dialogContext?.$dynamicComponentClass

    constructor() {
        classes(() =>
            hlm([
                'max-w-lg rounded-xl border border-border-default bg-background-elevated p-6 text-content-primary shadow-lg duration-fast ease-standard relative mx-auto w-full outline-none sm:mx-0',
                this._dynamicComponentClass,
            ]),
        )
    }
}
