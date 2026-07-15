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

    test('renders completed import results and returns to the idle import action', async ({ page }) => {
        const controller = await createRendererScenario(page, rendererScenarios.feed.emptyNoSetup())

        await expect(page.getByRole('button', { name: 'Import Emails' })).toBeVisible()

        await controller.emit('email-import-progress', {
            phase: 'completed',
            totalProcessed: 8,
            totalImported: 5,
            newlyImported: 3,
        })

        await expect(page.getByText('Done! Processed 8 emails, imported 3 new ones.')).toBeVisible()

        await page.getByRole('button', { name: 'Cool' }).click()

        await expect(page.getByRole('button', { name: 'Import Emails' })).toBeVisible()
        await expect(page.getByText('Done! Processed 8 emails, imported 3 new ones.')).toBeHidden()
    })

    test('renders import errors and retries the import action', async ({ page }) => {
        const controller = await createRendererScenario(page, rendererScenarios.feed.emptyNoSetup())

        await expect(page.getByRole('button', { name: 'Import Emails' })).toBeVisible()

        await controller.emit('email-import-progress', {
            phase: 'error',
            errorMessage: 'Apple Mail export failed',
        })

        await expect(page.getByText('Apple Mail export failed')).toBeVisible()

        await page.getByRole('button', { name: 'Retry' }).click()

        await expect.poll(async () => controller.calls('trigger-email-import')).toHaveLength(1)
    })
})
