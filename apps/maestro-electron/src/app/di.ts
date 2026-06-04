import { DatabaseClient } from './database/database.client'
import { SettingsBackendService } from './services/settings.backend.service'
import { EmailBackendRepository } from './services/email/email.backend.repository'
import { FeedBackendRepository } from './services/feed/feed.backend.repository'
import { FeedBackendService } from './services/feed/feed.backend.service'
import { BandcampApiBackendService } from './services/bandcamp/bandcamp-api.backend.service'
import { WebScrapingService } from './services/web-scraping/web-scraping.service'
import { DiContainer } from './utils/dependency-injection.util'

export const diContainer = new DiContainer({
    providers: [
        {
            provide: DatabaseClient,
            useFactory: () => new DatabaseClient(),
        },
        {
            provide: SettingsBackendService,
            useFactory: () => new SettingsBackendService(),
        },
        {
            provide: EmailBackendRepository,
            useFactory: async (di) => new EmailBackendRepository(await di.get(SettingsBackendService)),
        },
        {
            provide: FeedBackendRepository,
            useFactory: async (di) => new FeedBackendRepository(await di.get(DatabaseClient)),
        },
        {
            provide: BandcampApiBackendService,
            useFactory: () => new BandcampApiBackendService(),
        },
        {
            provide: WebScrapingService,
            useFactory: () => new WebScrapingService(),
        },
        {
            provide: FeedBackendService,
            useFactory: async (di) =>
                new FeedBackendService(
                    await di.get(EmailBackendRepository),
                    await di.get(BandcampApiBackendService),
                    await di.get(WebScrapingService),
                    await di.get(FeedBackendRepository),
                ),
        },
    ],
})