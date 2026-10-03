import {
    afterNextRender,
    ChangeDetectionStrategy,
    Component,
    computed,
    ElementRef,
    inject,
    Injector,
    linkedSignal,
    signal,
    viewChild,
} from '@angular/core'
import { FormsModule } from '@angular/forms'
import { SettingsService } from '../../../core/settings/settings.service'

@Component({
    selector: 'app-feed-settings',
    imports: [FormsModule],
    templateUrl: './feed-settings.component.html',
    changeDetection: ChangeDetectionStrategy.OnPush,
})
export class FeedSettingsComponent {
    private readonly injector = inject(Injector)
    private readonly filterCheckbox = viewChild.required<ElementRef<HTMLInputElement>>('filterCheckbox')
    readonly settingsService = inject(SettingsService)
    readonly hideUnplayableReleases = linkedSignal(() =>
        this.settingsService.settings.hasValue()
            ? (this.settingsService.settings.value()?.feed?.hideUnplayableReleases ?? true)
            : true,
    )
    readonly hasChanges = computed(
        () =>
            this.settingsService.settings.hasValue() &&
            this.hideUnplayableReleases() !==
                (this.settingsService.settings.value()?.feed?.hideUnplayableReleases ?? true),
    )
    readonly saving = signal(false)
    readonly saveError = signal<string | null>(null)

    async saveSettings(event: MouseEvent): Promise<void> {
        if (!this.hasChanges() || this.saving()) return
        const restoreFocus = event.currentTarget === document.activeElement
        this.saving.set(true)
        this.saveError.set(null)
        try {
            await this.settingsService.patchSettings({
                feed: { hideUnplayableReleases: this.hideUnplayableReleases() },
            })
        } catch {
            this.saveError.set('Could not save feed settings. Try again.')
        } finally {
            this.saving.set(false)
            if (restoreFocus) {
                afterNextRender(() => this.filterCheckbox().nativeElement.focus(), {
                    injector: this.injector,
                })
            }
        }
    }
}
