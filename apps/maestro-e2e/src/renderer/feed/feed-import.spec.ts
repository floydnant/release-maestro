// Covers Bandcamp notification import progress and cancellation from the release feed shell.
import { expect, test } from '@playwright/test'
import { createRendererScenario, rendererScenarios } from '../scenario-harness'

test.describe('release feed import scenarios', () => {
    test('emits import progress events and records cancel IPC calls', async ({ page }) => {
        const controller = await createRendererScenario(page, rendererScenarios.feed.emptyNoSetup())

        await page.getByRole('button', { name: 'Import Emails' }).click()
        await expect
            .poll(async () => controller.lastCall('trigger-email-import'))
            .toMatchObject({ channel: 'trigger-email-import' })

        await controller.emit('email-import-progress', {
            phase: 'processing',
            current: 2,
            total: 5,
            message: 'Importing Bandcamp notifications',
        })

        await expect(page.getByText('Importing Bandcamp notifications')).toBeVisible()
        await expect(page.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '40')

        await page.getByRole('button', { name: 'Cancel' }).click()

        await expect.poll(async () => controller.calls('email-import-abort')).toHaveLength(1)
    })
})
