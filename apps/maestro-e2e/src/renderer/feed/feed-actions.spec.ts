// Covers direct release feed item actions that dispatch mocked IPC calls or update local item state.
import { expect, test } from '@playwright/test'
import { createHydratedRelease, createRendererScenario, scenarioBuilder } from '../scenario-harness'

test.describe('release feed item actions', () => {
    test('opens the current release in the browser from the keyboard shortcut', async ({ page }) => {
        const baseRelease = createHydratedRelease()
        const release = createHydratedRelease({
            data: {
                ...baseRelease.data,
                releaseUrl: 'https://example.bandcamp.com/album/keyboard-open',
            },
        })
        const controller = await createRendererScenario(page, scenarioBuilder().feed([release]).build())

        await page.keyboard.press('O')

        await expect
            .poll(async () => controller.lastCall('open-url'))
            .toMatchObject({ channel: 'open-url', payload: release.data.releaseUrl })
    })

    test('toggles the current feed item snooze state', async ({ page }) => {
        await createRendererScenario(page, scenarioBuilder().feed([createHydratedRelease()]).build())

        const snoozeButton = page.getByTitle('Click to snooze (show again tomorrow)')

        await expect(snoozeButton).toBeVisible()

        await snoozeButton.click()

        await expect(page.getByTitle(/Click to un-snooze/)).toBeVisible()
    })
})
