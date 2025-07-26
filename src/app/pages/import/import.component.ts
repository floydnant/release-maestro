import { ChangeDetectionStrategy, Component } from '@angular/core'
import { RouterModule } from '@angular/router'

@Component({
    selector: 'app-import',
    imports: [RouterModule, RouterModule],
    templateUrl: './import.component.html',
    styles: `
        :host {
            @apply flex w-full;
        }
    `,
    changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ImportComponent {}
