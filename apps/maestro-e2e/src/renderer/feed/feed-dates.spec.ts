import { expect, test } from '@playwright/test'
import { createHydratedRelease, createRendererScenario, scenarioBuilder } from '../scenario-harness'

test.use({ timezoneId: 'Europe/Berlin' })

test.describe('release feed calendar dates', () => {
    for (const { releaseDate, expected } of [
        { releaseDate: '2026-09-19T00:00:00+02:00', expected: 'releases today' },
        { releaseDate: '2026-09-20T00:00:00+02:00', expected: 'releases tomorrow' },
    ]) {
        test(`shows ${expected} while keeping the announcement time precise`, async ({ page }) => {
            await page.clock.setFixedTime(new Date('2026-09-19T23:55:00+02:00'))
            const release = createHydratedRelease()
            release.data.releaseDate = new Date(releaseDate)
            release.data.emailReceivedAt = new Date('2026-09-19T23:50:00+02:00')

            await createRendererScenario(page, scenarioBuilder().feed([release]).build())

            await expect(
                page.getByText(`${expected}, announced 5 minutes ago`, { exact: true }),
            ).toBeVisible()
        })
    }
})
