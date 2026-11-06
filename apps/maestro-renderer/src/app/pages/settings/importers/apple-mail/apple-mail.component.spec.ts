import { signal } from '@angular/core'
import { ComponentFixture, TestBed } from '@angular/core/testing'
import { AppSettings, EmailImportProgressUpdate } from '@release-maestro/core'
import { fromPartial } from '@total-typescript/shoehorn'
import { FeedService } from '../../../../core/services/feed.service'
import { SettingsService } from '../../../../core/settings/settings.service'
import { AppleMailImporterComponent } from './apple-mail.component'

describe('AppleMailComponent', () => {
    let component: AppleMailImporterComponent
    let fixture: ComponentFixture<AppleMailImporterComponent>
    const emailImportUpdate = signal<EmailImportProgressUpdate | null>(null)
    const cancelEmailImport = jest.fn()

    beforeEach(async () => {
        emailImportUpdate.set(null)
        cancelEmailImport.mockReset()
        await TestBed.configureTestingModule({
            imports: [AppleMailImporterComponent],
            providers: [
                {
                    provide: FeedService,
                    useValue: fromPartial<FeedService>({
                        emailImportUpdate,
                        cancelEmailImport,
                        triggerEmailImport: jest.fn(),
                    }),
                },
                {
                    provide: SettingsService,
                    useValue: fromPartial<SettingsService>({
                        settings: {
                            value: () =>
                                fromPartial<AppSettings>({
                                    emailPluginConfig: { APPLE_MAIL: { mailboxName: 'Bandcamp' } },
                                }),
                        },
                    }),
                },
            ],
        }).compileComponents()

        fixture = TestBed.createComponent(AppleMailImporterComponent)
        component = fixture.componentInstance
        fixture.detectChanges()
    })

    const element = () => fixture.nativeElement as HTMLElement
    const emit = (update: EmailImportProgressUpdate) => {
        emailImportUpdate.set(update)
        fixture.detectChanges()
    }
    const progressText = () =>
        element().querySelector('.email-import-progress p')?.textContent?.replace(/\s+/g, ' ').trim()
    const ring = () => element().querySelector('.email-import-progress [role="progressbar"]')
    const button = (name: string) =>
        [...element().querySelectorAll('button')].find(candidate => candidate.textContent?.trim() === name)

    it('should create', () => {
        expect(component).toBeTruthy()
    })

    it('counts processed emails after the export from where they stood, and stays cancellable', () => {
        emit({ phase: 'processing', current: 40, total: 40, message: 'Importing', trigger: 'manual' })
        expect(progressText()).toBe('Importing emails 40/40')

        emit({ phase: 'finishing', current: 30, total: 40, trigger: 'manual' })
        expect(progressText()).toBe('Processing emails 30/40')
        expect(ring()?.getAttribute('aria-label')).toBe('Processing emails')
        expect(ring()?.getAttribute('aria-valuenow')).toBe('75')
        expect(element().querySelector('.email-import-progress hlm-spinner')).toBeNull()
        expect(button('Import now')?.disabled).toBe(true)
        expect(button('Cancel import')?.getAttribute('aria-describedby')).toBe('email-import-finishing')

        emit({ phase: 'finishing', current: 36, total: 40, trigger: 'manual' })
        expect(progressText()).toBe('Processing emails 36/40')
        expect(ring()?.getAttribute('aria-valuenow')).toBe('90')

        button('Cancel import')?.click()
        expect(cancelEmailImport).toHaveBeenCalledTimes(1)
        expect(progressText()).toBe('Processing emails 36/40')

        emit({ phase: 'cancelled', trigger: 'manual' })
        expect(element().querySelector('.email-import-progress')).toBeNull()
        expect(element().querySelector('.email-import-finishing')).toBeNull()
    })

    it('spins until the export reports a count', () => {
        emit({ phase: 'started', trigger: 'auto' })

        expect(progressText()).toBe('Checking mail…')
        expect(ring()).toBeNull()
        expect(element().querySelector('.email-import-progress hlm-spinner')).not.toBeNull()
    })
})
