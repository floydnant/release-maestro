import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing'
import { TestBed } from '@angular/core/testing'
import { TranslateService } from '@ngx-translate/core'
import { firstValueFrom } from 'rxjs'
import { appConfig } from './app.config'

describe('translation configuration', () => {
    beforeEach(() => {
        TestBed.configureTestingModule({
            providers: [...appConfig.providers, provideHttpClientTesting()],
        })
    })

    afterEach(() => TestBed.inject(HttpTestingController).verify())

    it('loads translations relative to the application for packaged file URLs', async () => {
        const translate = TestBed.inject(TranslateService)
        const loaded = firstValueFrom(translate.use('en'))

        TestBed.inject(HttpTestingController)
            .expectOne('./i18n/en.json')
            .flush({ PAGES: { HOME: { TITLE: 'Home' } } })

        await loaded
        expect(translate.instant('PAGES.HOME.TITLE')).toBe('Home')
    })

    it('reports a missing translation file as an error', async () => {
        const loaded = firstValueFrom(TestBed.inject(TranslateService).use('en'))
        const rejected = expect(loaded).rejects.toMatchObject({ status: 404 })

        TestBed.inject(HttpTestingController)
            .expectOne('./i18n/en.json')
            .flush('Not found', { status: 404, statusText: 'Not Found' })

        await rejected
    })
})
