// Covers preview playback and seeking behavior for feed item tracks.
import { expect, test } from '@playwright/test'
import { createHydratedRelease, createRendererScenario, scenarioBuilder } from '../scenario-harness'

test.describe('release feed playback scenarios', () => {
    test('plays and seeks a real preview stream', async ({ page }) => {
        const release = createHydratedRelease()

        await createRendererScenario(page, scenarioBuilder().feed([release]).build())

        await page.getByRole('button', { name: 'Play Karasu' }).click()
        await expect(page.getByRole('button', { name: 'Pause Karasu' })).toBeVisible()

        const progress = page.getByRole('progressbar', { name: 'Karasu playback progress' })
        await expect
            .poll(async () => Number((await progress.getAttribute('aria-valuemax')) ?? 0), {
                timeout: 15_000,
            })
            .toBeGreaterThan(1)

        const seeker = page.getByRole('button', { name: 'Seek within Karasu' })
        const seekerBox = await seeker.boundingBox()
        // eslint-disable-next-line playwright/no-conditional-in-test
        if (!seekerBox) throw new Error('Track seeker was not rendered')

        await seeker.click({
            position: {
                x: seekerBox.width * 0.8,
                y: seekerBox.height / 2,
            },
        })

        await expect
            .poll(async () => {
                const currentTime = Number((await progress.getAttribute('aria-valuenow')) ?? 0)
                const duration = Number((await progress.getAttribute('aria-valuemax')) ?? 1)
                return currentTime / duration
            })
            .toBeGreaterThan(0.7)
    })
})
