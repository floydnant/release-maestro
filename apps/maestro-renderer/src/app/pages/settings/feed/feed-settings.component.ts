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
import {
    DEFAULT_FEED_SNOOZE_HOURS,
    FEED_SNOOZE_HOURS_STEP,
    feedSnoozeHoursSchema,
    MAX_FEED_SNOOZE_HOURS,
    MIN_FEED_SNOOZE_HOURS,
} from '@release-maestro/core'
import { HlmButton } from '@spartan-ng/helm/button'
import { HlmInput } from '@spartan-ng/helm/input'
import { HlmSwitch } from '@spartan-ng/helm/switch'
import { SettingsService } from '../../../core/settings/settings.service'

@Component({
    selector: 'app-feed-settings',
    imports: [HlmButton, HlmInput, HlmSwitch],
    templateUrl: './feed-settings.component.html',
    changeDetection: ChangeDetectionStrategy.OnPush,
})
export class FeedSettingsComponent {
    private readonly injector = inject(Injector)
    private readonly filterSwitch = viewChild.required(HlmSwitch)
    private readonly saveButton = viewChild<ElementRef<HTMLButtonElement>>('saveButton')
    private readonly snoozeHoursField = viewChild<ElementRef<HTMLInputElement>>('snoozeHoursField')
    readonly settingsService = inject(SettingsService)
    readonly minSnoozeHours = MIN_FEED_SNOOZE_HOURS
    readonly maxSnoozeHours = MAX_FEED_SNOOZE_HOURS
    readonly snoozeHoursStep = FEED_SNOOZE_HOURS_STEP
    private readonly savedFeed = computed(() =>
        this.settingsService.settings.hasValue() ? this.settingsService.settings.value()?.feed : undefined,
    )
    private readonly savedSnoozeHours = computed(
        () => this.savedFeed()?.snoozeHours ?? DEFAULT_FEED_SNOOZE_HOURS,
    )
    readonly hideUnplayableReleases = linkedSignal(() => this.savedFeed()?.hideUnplayableReleases ?? true)
    /** The field's raw text, so an empty or partial entry can be shown and corrected. */
    readonly snoozeHoursText = linkedSignal(() => String(this.savedSnoozeHours()))
    /** The entered hours, or null while the entry is not a duration the settings accept. */
    readonly snoozeHours = computed(() => {
        const text = this.snoozeHoursText().trim()
        const parsed = feedSnoozeHoursSchema.safeParse(Number(text))
        return text !== '' && parsed.success ? parsed.data : null
    })
    readonly hasChanges = computed(
        () =>
            this.settingsService.settings.hasValue() &&
            (this.hideUnplayableReleases() !== (this.savedFeed()?.hideUnplayableReleases ?? true) ||
                this.snoozeHours() !== this.savedSnoozeHours()),
    )
    readonly saving = signal(false)
    readonly saveError = signal<string | null>(null)

    async saveSettings(event: MouseEvent): Promise<void> {
        const snoozeHours = this.snoozeHours()
        if (!this.hasChanges() || this.saving() || snoozeHours === null) return
        // Disabling Save while it is pending drops its focus, so return focus once it settles:
        // to the setting that changed after a save removes Save, or to Save to retry a failed one.
        const restoreFocus = event.currentTarget === document.activeElement
        const snoozeChanged = snoozeHours !== this.savedSnoozeHours()
        this.saving.set(true)
        this.saveError.set(null)
        try {
            await this.settingsService.patchSettings({
                feed: { hideUnplayableReleases: this.hideUnplayableReleases(), snoozeHours },
            })
        } catch {
            this.saveError.set('Could not save feed settings. Try again.')
        } finally {
            this.saving.set(false)
            if (restoreFocus) {
                afterNextRender(
                    () => {
                        const saveButton = this.saveButton()
                        if (saveButton) saveButton.nativeElement.focus()
                        else if (snoozeChanged) this.snoozeHoursField()?.nativeElement.focus()
                        else this.filterSwitch().focus()
                    },
                    { injector: this.injector },
                )
            }
        }
    }
}
