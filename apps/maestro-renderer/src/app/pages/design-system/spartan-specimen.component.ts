import { ChangeDetectionStrategy, Component, signal } from '@angular/core'
import type { BrnSelect } from '@spartan-ng/brain/select'
import { HlmBadgeImports } from '@spartan-ng/helm/badge'
import { HlmButtonImports } from '@spartan-ng/helm/button'
import { HlmCardImports } from '@spartan-ng/helm/card'
import { HlmDialogImports } from '@spartan-ng/helm/dialog'
import { HlmDropdownMenuImports } from '@spartan-ng/helm/dropdown-menu'
import { HlmInputImports } from '@spartan-ng/helm/input'
import { HlmNativeSelectImports } from '@spartan-ng/helm/native-select'
import { HlmProgressImports } from '@spartan-ng/helm/progress'
import { HlmSelectImports } from '@spartan-ng/helm/select'
import { HlmSpinnerImports } from '@spartan-ng/helm/spinner'
import { HlmTooltipImports } from '@spartan-ng/helm/tooltip'

@Component({
    selector: 'app-spartan-specimen',
    imports: [
        HlmBadgeImports,
        HlmButtonImports,
        HlmCardImports,
        HlmDialogImports,
        HlmDropdownMenuImports,
        HlmInputImports,
        HlmNativeSelectImports,
        HlmProgressImports,
        HlmSelectImports,
        HlmSpinnerImports,
        HlmTooltipImports,
    ],
    templateUrl: './spartan-specimen.component.html',
    changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SpartanSpecimenComponent {
    readonly order = signal<string | null | undefined>('dateAdded')
    readonly libraryView = signal<ReturnType<BrnSelect<string>['value']>>('Tracks')
    readonly savedFolderLabel = signal<string | null>(null)
    readonly selectedAction = signal<string | null>(null)
}
