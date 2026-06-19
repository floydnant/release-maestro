import { ChangeDetectionStrategy, Component, input } from '@angular/core'
import { provideIcons, NgIcon } from '@ng-icons/core'
import {
    octCheckCircleFill,
    octDash,
    octScreenFull,
    octScreenNormal,
    octX,
    octXCircleFill,
} from '@ng-icons/octicons'
import { semanticColor, SemanticColorIdentifier } from '../../design-tokens.generated'

const icons = {
    octCheckCircleFill,
    octDash,
    octScreenFull,
    octScreenNormal,
    octX,
    octXCircleFill,
} satisfies Record<string, string>
export type IconIdentitfier = keyof typeof icons

@Component({
    selector: 'app-icon',
    imports: [NgIcon],
    template: `
        <ng-icon [name]="name()" [color]="color()" [strokeWidth]="strokeWidth()" [size]="size()"></ng-icon>
    `,
    changeDetection: ChangeDetectionStrategy.OnPush,
    viewProviders: [provideIcons(icons)],
    host: {
        class: 'inline-block',
    },
})
export class IconComponent {
    name = input.required<IconIdentitfier>()
    color = input<string | undefined, SemanticColorIdentifier | undefined>(undefined, {
        transform: value => value && semanticColor(value),
    })
    strokeWidth = input<number | undefined>()
    size = input<string>('')
}
