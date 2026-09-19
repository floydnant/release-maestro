import { expect, test } from '@playwright/test'
import { tralbumDataAttrSchema } from '@release-maestro/core'
import { createHydratedRelease, createRendererScenario, scenarioBuilder } from '../scenario-harness'

for (const timezoneId of ['Europe/Berlin', 'America/Los_Angeles', 'Pacific/Auckland']) {
    test.describe(`release feed calendar dates in ${timezoneId}`, () => {
        test.use({ timezoneId })

        for (const { releaseDate, expected } of [
            { releaseDate: '19 Sep 2026 00:00:00 GMT', expected: 'releases today' },
            { releaseDate: '20 Sep 2026 00:00:00 +1400', expected: 'releases tomorrow' },
            { releaseDate: '18 Sep 2026 23:59:59 -1200', expected: 'released yesterday' },
            { releaseDate: null, expected: null },
        ]) {
            test(`shows ${expected ?? 'an unknown release date'} with day-level announcements`, async ({
                page,
            }) => {
                // All three browser timezones are on September 19 at this instant.
                await page.clock.setFixedTime(new Date('2026-09-19T10:00:00Z'))
                const release = createHydratedRelease()
                release.data.releaseDate =
                    tralbumDataAttrSchema.shape.album_release_date.parse(releaseDate) ?? null
                release.data.emailReceivedAt = new Date('2026-09-19T09:55:00Z')

                await createRendererScenario(page, scenarioBuilder().feed([release]).build())

                const dates = page.getByText(`${expected ? expected + ', ' : ''}announced today`, {
                    exact: true,
                })
                await expect(dates).toBeVisible()
                await expect(dates).toHaveAttribute('title', /announced today$/)
                if (release.data.releaseDate) {
                    const day = Number(release.data.releaseDate.slice(-2))
                    await expect(dates).toHaveAttribute('title', `released Sep ${day}, 2026, announced today`)
                }
            })
        }

        test('uses the local announcement day across midnight', async ({ page }) => {
            const reference = await page.evaluate(() => new Date(2026, 8, 19, 0, 5).toISOString())
            await page.clock.setFixedTime(new Date(reference))
            const release = createHydratedRelease()
            release.data.emailReceivedAt = new Date(new Date(reference).valueOf() - 10 * 60 * 1000)
            await createRendererScenario(page, scenarioBuilder().feed([release]).build())
            await expect(page.getByText('announced yesterday', { exact: true })).toBeVisible()
        })
    })
}
