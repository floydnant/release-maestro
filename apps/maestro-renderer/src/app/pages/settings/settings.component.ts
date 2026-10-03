import { ChangeDetectionStrategy, Component } from '@angular/core'
import { RouterModule } from '@angular/router'
import { HlmButton } from '@spartan-ng/helm/button'
import { webEnv } from '../../../environments/environment'

@Component({
    selector: 'app-import',
    imports: [RouterModule, HlmButton],
    templateUrl: './settings.component.html',
    host: { class: 'flex h-full min-h-0 w-full' },
    changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SettingsComponent {
    readonly showDesignSystem = !webEnv.production
}
