import { createMigratedTestDatabase } from '../../../test/fixtures/database.fixture'
import { FeedBackendRepository } from './feed.backend.repository'

describe('FeedBackendRepository email import checkpoint', () => {
    it('never moves a checkpoint backwards', async () => {
        const repository = new FeedBackendRepository(createMigratedTestDatabase().client)
        const newest = new Date('2026-10-01T21:40:12')

        await repository.advanceEmailImportCheckpoint('APPLE_MAIL', 'Bandcamp', newest)
        await repository.advanceEmailImportCheckpoint(
            'APPLE_MAIL',
            'Bandcamp',
            new Date('2026-09-01T00:00:00'),
        )

        await expect(repository.getEmailImportCheckpoint('APPLE_MAIL', 'Bandcamp')).resolves.toEqual(newest)
    })
})
