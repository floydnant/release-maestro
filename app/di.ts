import { entriesOf, Prettify } from '../shared/utils/object.utils'
import { BandcampApiBackendService } from './bandcamp/bandcamp-api.backend.service'
import { DatabaseClient } from './database/database.client'
import { EmailBackendRepository, emailImporterPlugins } from './email/email.backend.repository'
import { FeedBackendRepository } from './feed/feed.backend.repository'
import { FeedBackendService } from './feed/feed.backend.service'
import { SettingsBackendService } from './settings.backend.service'
import { DiContainer } from './utils/dependency-injection.util'
import { WebScrapingService } from './web-scraping/web-scraping.service'

export const diContainer = new DiContainer({
    providers: [
        {
            provide: EmailBackendRepository,
            useFactory: () => new EmailBackendRepository(),
        },
        {
            provide: FeedBackendService,
            useFactory: async di =>
                new FeedBackendService(
                    await di.get(EmailBackendRepository),
                    await di.get(BandcampApiBackendService),
                    await di.get(WebScrapingService),
                    await di.get(FeedBackendRepository),
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
        ...entriesOf(emailImporterPlugins).map(([_pluginIdentifier, Plugin]) => ({
            provide: Plugin,
            useFactory: async (di: Prettify<DiContainer>) => {
                return new Plugin(await di.get(SettingsBackendService))
            },
        })),
        {
            provide: FeedBackendRepository,
            useFactory: async di => new FeedBackendRepository(await di.get(DatabaseClient)),
        },
        {
            provide: DatabaseClient,
            useFactory: () => new DatabaseClient(),
        },
        {
            provide: SettingsBackendService,
            useFactory: () => new SettingsBackendService(),
        },
    ],
})
