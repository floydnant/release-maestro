import { ChangeDetectionStrategy, Component } from '@angular/core'
import { RouterModule } from '@angular/router'

@Component({
    selector: 'app-import',
    imports: [RouterModule],
    templateUrl: './settings.component.html',
    styles: `
        :host {
            @apply flex w-full;
        }
    `,
    changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SettingsComponent {}
