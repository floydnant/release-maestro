import { ChangeDetectionStrategy, Component, input } from '@angular/core'
import { provideIcons, NgIcon } from '@ng-icons/core'
import { octCheckCircleFill, octXCircleFill } from '@ng-icons/octicons'
import { colorFrom, ColorIdentifier } from '../../colors'

const icons = { octCheckCircleFill, octXCircleFill } satisfies Record<string, string>
export type IconIdentitfier = keyof typeof icons

@Component({
    selector: 'app-icon',
    imports: [NgIcon],
    template: `
        <ng-icon [name]="name()" [color]="color()" [strokeWidth]="strokeWidth()" [size]="size()"></ng-icon>
    `,
    styles: ``,
    changeDetection: ChangeDetectionStrategy.OnPush,
    viewProviders: [provideIcons(icons)],
    host: {
        class: 'inline-block',
    },
})
export class IconComponent {
    name = input.required<IconIdentitfier>()
    color = input<string | undefined, ColorIdentifier | undefined>(undefined, {
        transform: v => v && colorFrom(v),
    })
    strokeWidth = input<number | undefined>()
    size = input<string>('')
}
