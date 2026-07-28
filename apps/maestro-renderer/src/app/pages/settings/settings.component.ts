import { ChangeDetectionStrategy, Component } from '@angular/core'
import { RouterModule } from '@angular/router'

@Component({
    selector: 'app-import',
    imports: [RouterModule],
    templateUrl: './settings.component.html',
    styles: `
        :host {
            @apply flex h-full min-h-0 w-full;
        }
    `,
    changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SettingsComponent {}
