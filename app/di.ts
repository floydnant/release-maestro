import { BandcampApiBackendService } from './bandcamp/bandcamp-api.backend.service'
import { BandcampEmailBackendService } from './bandcamp/bandcamp-email.backend.service'
import { EmailBackendRepository } from './email/email.backend.repository'
import { FeedBackendService } from './feed/feed.backend.service'
import { DiContainer } from './utils/dependency-injection.util'

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
                ),
        },
        {
            provide: BandcampApiBackendService,
            useFactory: () => new BandcampApiBackendService(),
        },
    ],
})
