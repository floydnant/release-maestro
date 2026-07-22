import { ChangeDetectionStrategy, Component, input } from '@angular/core'
import { NgIcon, provideIcons } from '@ng-icons/core'
import {
    octCheckCircleFill,
    octDash,
    octFileDirectory,
    octFileDirectoryFill,
    octPlus,
    octScreenFull,
    octScreenNormal,
    octX,
    octXCircleFill,
} from '@ng-icons/octicons'
import { solarAlarmSleepBold, solarPauseBold, solarPlayBold } from '@ng-icons/solar-icons/bold'
import { solarAlarmSleep } from '@ng-icons/solar-icons/outline'
import { semanticColor, SemanticColorIdentifier } from '../../design-tokens.generated'

const icons = {
    octCheckCircleFill,
    octDash,
    octFileDirectory,
    octFileDirectoryFill,
    octPlus,
    octScreenFull,
    octScreenNormal,
    octX,
    octXCircleFill,
    play: solarPlayBold,
    pause: solarPauseBold,
    snooze: solarAlarmSleep,
    snoozeFilled: solarAlarmSleepBold,
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
        class: 'inline-flex items-center justify-center',
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
