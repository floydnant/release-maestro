import { ChangeDetectionStrategy, Component, inject } from '@angular/core'
import { Router, RouterModule } from '@angular/router'
import { HlmDialogImports } from '@spartan-ng/helm/dialog'
import { HlmSidebarImports } from '@spartan-ng/helm/sidebar'
import { webEnv } from '../../../environments/environment'

/**
 * The settings dialog. It lives in the root `modal` outlet, so opening and closing it are route
 * changes: Back closes it, and each section has a URL.
 */
@Component({
    selector: 'app-settings',
    imports: [RouterModule, HlmDialogImports, HlmSidebarImports],
    templateUrl: './settings.component.html',
    changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SettingsComponent {
    private readonly router = inject(Router)

    readonly showDevelopmentSettings = !webEnv.production

    /** Escape, the backdrop and the close button dismiss the dialog; leaving the route follows. */
    close() {
        void this.router.navigate([{ outlets: { modal: null } }])
    }
}
