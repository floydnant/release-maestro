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
        await expect(mailboxInput).toHaveAccessibleDescription(
            'The name of the mailbox to import from Apple Mail.',
        )
        await page.getByText('Mailbox Name', { exact: true }).click()
        await expect(mailboxInput).toBeFocused()

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

    test('debug disclosures work from the keyboard and field help stays associated', async ({ page }) => {
        await createRendererScenario(page, scenarioBuilder().build(), '/settings/debug')

        const healthPayload = page.getByLabel('Metadata worker health payload')
        const disclosure = page.getByRole('button', { name: 'Health payload' })
        await expect(healthPayload).toBeHidden()
        await disclosure.press('Enter')
        await expect(disclosure).toHaveAttribute('aria-expanded', 'true')
        await expect(healthPayload).toBeVisible()
        await expect(healthPayload).toContainText('"ok": true')
        await disclosure.press('Space')
        await expect(healthPayload).toBeHidden()
        await expect(disclosure).toBeFocused()

        await expect(page.getByLabel('Write tag payload')).toHaveAccessibleDescription(
            'Writes go through the Rust engine tri-state update contract. Use this only on disposable files.',
        )
        await expect(page.getByLabel('Library scan paths')).toHaveAccessibleDescription(
            'Enter one folder per line, or leave empty to scan the configured library folders. Runs through the shared LibraryScanService (same as onboarding and startup rescans).',
        )
    })
})
