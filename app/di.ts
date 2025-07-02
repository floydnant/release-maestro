import { BandcampApiBackendService } from './bandcamp/bandcamp-api.backend.service'
import { BandcampEmailBackendService } from './bandcamp/bandcamp-email.backend.service'
import { EmailBackendRepository } from './email/email.backend.repository'
import { FeedBackendService } from './feed/feed.backend.service'
import { DiContainer } from './utils/dependency-injection.util'
import { WebScrapingService } from './web-scraping/web-scraping.service'

export const diContainer = new DiContainer({
    providers: [
        {
            provide: EmailBackendRepository,
            useFactory: () => new EmailBackendRepository(),
        },
        {
            provide: BandcampEmailBackendService,
            useFactory: async di => new BandcampEmailBackendService(await di.get(EmailBackendRepository)),
        },
        {
            provide: FeedBackendService,
            useFactory: async di =>
                new FeedBackendService(
                    await di.get(BandcampEmailBackendService),
                    await di.get(BandcampApiBackendService),
                    await di.get(WebScrapingService),
                ),
        },
        {
            provide: BandcampApiBackendService,
            useFactory: () => new BandcampApiBackendService(),
        },
        {
            provide: WebScrapingService,
            useFactory: () => new WebScrapingService(),
        },
    ],
})
