import { ChangeDetectionStrategy, Component, signal } from '@angular/core'
import type { BrnSelect } from '@spartan-ng/brain/select'
import { HlmAvatarImports } from '@spartan-ng/helm/avatar'
import { HlmBadgeImports } from '@spartan-ng/helm/badge'
import { HlmButtonImports } from '@spartan-ng/helm/button'
import { HlmCardImports } from '@spartan-ng/helm/card'
import { HlmDialogImports } from '@spartan-ng/helm/dialog'
import { HlmDropdownMenuImports } from '@spartan-ng/helm/dropdown-menu'
import { HlmInputImports } from '@spartan-ng/helm/input'
import { HlmLabel } from '@spartan-ng/helm/label'
import { HlmProgressImports } from '@spartan-ng/helm/progress'
import { HlmSelectImports } from '@spartan-ng/helm/select'
import { HlmSpinnerImports } from '@spartan-ng/helm/spinner'
import { HlmSwitchImports } from '@spartan-ng/helm/switch'
import { HlmTooltipImports } from '@spartan-ng/helm/tooltip'

@Component({
    selector: 'app-spartan-specimen',
    imports: [
        HlmAvatarImports,
        HlmBadgeImports,
        HlmButtonImports,
        HlmCardImports,
        HlmDialogImports,
        HlmDropdownMenuImports,
        HlmInputImports,
        HlmLabel,
        HlmProgressImports,
        HlmSelectImports,
        HlmSpinnerImports,
        HlmSwitchImports,
        HlmTooltipImports,
    ],
    templateUrl: './spartan-specimen.component.html',
    changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SpartanSpecimenComponent {
    readonly libraryView = signal<ReturnType<BrnSelect<string>['value']>>('Tracks')
    readonly savedFolderLabel = signal<string | null>(null)
    readonly selectedAction = signal<string | null>(null)
    readonly hideUnplayableReleases = signal(true)
    readonly avatarSizes = ['xs', 'sm', 'default', 'lg'] as const
    readonly avatarPhoto = `data:image/svg+xml,${encodeURIComponent(
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" fill="#4f6d8f"/><circle cx="32" cy="25" r="12" fill="#c9d6e3"/><ellipse cx="32" cy="60" rx="22" ry="17" fill="#2c3e50"/></svg>',
    )}`
    /** Not a decodable image, so the avatar shows its fallback. */
    readonly brokenAvatarPhoto = 'data:image/png;base64,'
}
