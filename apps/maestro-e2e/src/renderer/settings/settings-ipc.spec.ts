// Covers settings pages that load and save state through mocked IPC handlers.
import { expect, test } from '@playwright/test'
import { createRendererScenario, scenarioBuilder } from '../scenario-harness'

test.describe('settings IPC scenarios', () => {
    test('loads and saves settings through configured IPC handlers', async ({ page }) => {
        const scenario = scenarioBuilder()
            .settings({
                library: { folders: ['/scenario/music'] },
                emailPluginConfig: { APPLE_MAIL: { mailboxName: 'Bandcamp Inbox' } },
            })
            .build()
        const controller = await createRendererScenario(page, scenario, '/settings/apple-mail')

        const mailboxInput = page.getByLabel('Mailbox Name')
        await expect(mailboxInput).toHaveValue('Bandcamp Inbox')

        await mailboxInput.fill('New Releases')
        await page.getByRole('button', { name: 'Save' }).click()

        await expect
            .poll(async () => controller.lastCall('set-settings'))
            .toMatchObject({
                channel: 'set-settings',
                payload: {
                    library: { folders: ['/scenario/music'] },
                    emailPluginConfig: { APPLE_MAIL: { mailboxName: 'New Releases' } },
                },
            })
    })

    test('shows the save action only while settings have unsaved changes', async ({ page }) => {
        const scenario = scenarioBuilder()
            .settings({
                library: { folders: ['/scenario/music'] },
                emailPluginConfig: { APPLE_MAIL: { mailboxName: 'Bandcamp Inbox' } },
            })
            .build()
        await createRendererScenario(page, scenario, '/settings/apple-mail')

        const mailboxInput = page.getByLabel('Mailbox Name')
        const saveButton = page.getByRole('button', { name: 'Save' })

        await expect(mailboxInput).toHaveValue('Bandcamp Inbox')
        await expect(saveButton).toBeHidden()

        await mailboxInput.fill('New Releases')
        await expect(saveButton).toBeVisible()

        await saveButton.click()
        await expect(saveButton).toBeHidden()
    })
})
