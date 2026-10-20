import { expect, test } from '@playwright/test'
import { createRendererScenario, scenarioBuilder } from '../scenario-harness'

test.describe('settings dialog', () => {
    test('preserves the old library settings URL', async ({ page }) => {
        await createRendererScenario(page, scenarioBuilder().build(), '/settings/library')
        await expect(page).toHaveURL(/\/home\(modal:settings\/library-folders\)$/)
        await expect(
            page.getByRole('dialog', { name: 'Settings' }).getByRole('heading', { name: 'Library folders' }),
        ).toBeVisible()
    })

    for (const { path, section, heading } of [
        { path: '/settings', section: 'library-folders', heading: 'Library folders' },
        { path: '/settings/library', section: 'library-folders', heading: 'Library folders' },
        { path: '/settings/apple-mail', section: 'apple-mail', heading: 'Apple Mail' },
    ]) {
        test(`keeps ${path} accessible before library onboarding`, async ({ page }) => {
            await createRendererScenario(
                page,
                scenarioBuilder()
                    .settings({ library: { folders: [], onboardingSkipped: false }, emailPluginConfig: {} })
                    .build(),
                path,
            )
            await expect(page).toHaveURL(new RegExp(`/import\\(modal:settings/${section}\\)$`))
            const dialog = page.getByRole('dialog', { name: 'Settings' })
            await expect(dialog).toBeVisible()
            await expect(dialog.getByRole('heading', { name: heading, exact: true })).toBeVisible()

            await page.keyboard.press('Escape')
            await expect(dialog).toBeHidden()
            await expect(page).toHaveURL(/\/import$/)
            await expect(page.getByRole('heading', { name: 'Set up your music library' })).toBeVisible()
            await page.goto('/home')
            await expect(page).toHaveURL(/\/import$/)
        })
    }

    test('opens feed setup over Feed and returns to Feed when dismissed', async ({ page }) => {
        await createRendererScenario(page, scenarioBuilder().feed([], { hasFeed: false }).build(), '/feed')
        const settingsLink = page.getByRole('link', { name: 'settings', exact: true })
        await settingsLink.click()
        await expect(page).toHaveURL(/\/feed\(modal:settings\/apple-mail\)$/)
        const dialog = page.getByRole('dialog', { name: 'Settings' })
        await expect(dialog.getByRole('textbox', { name: 'Mailbox Name' })).toBeVisible()

        await page.keyboard.press('Escape')
        await expect(dialog).toBeHidden()
        await expect(page).toHaveURL(/\/feed$/)
        await expect(settingsLink).toBeFocused()
    })

    test('opens over the current page and returns focus when dismissed', async ({ page }) => {
        await createRendererScenario(page, scenarioBuilder().build(), '/tracks')
        // Opened mid-navigation, the dialog would sit over an empty page instead of Tracks.
        await expect(page).toHaveURL(/\/tracks$/)
        const settingsLink = page.getByRole('link', { name: 'Settings', exact: true })
        await settingsLink.click()

        const dialog = page.getByRole('dialog', { name: 'Settings' })
        await expect(dialog).toBeVisible()
        await expect(page).toHaveURL(/\/tracks\(modal:settings\/library-folders\)$/)

        await dialog.getByRole('link', { name: 'Apple Mail' }).click()
        await expect(page).toHaveURL(/\/tracks\(modal:settings\/apple-mail\)$/)

        await page.keyboard.press('Escape')
        await expect(dialog).toBeHidden()
        await expect(page).toHaveURL(/\/tracks$/)
        await expect(settingsLink).toBeFocused()
    })

    test('Back steps through sections, then closes the dialog', async ({ page }) => {
        await createRendererScenario(page, scenarioBuilder().build(), '/tracks')
        // Opened mid-navigation, the dialog would sit over an empty page instead of Tracks.
        await expect(page).toHaveURL(/\/tracks$/)
        await page.getByRole('link', { name: 'Settings', exact: true }).click()
        const dialog = page.getByRole('dialog', { name: 'Settings' })
        await dialog.getByRole('link', { name: 'Apple Mail' }).click()
        await expect(page).toHaveURL(/\/tracks\(modal:settings\/apple-mail\)$/)

        await page.goBack()
        await expect(page).toHaveURL(/\/tracks\(modal:settings\/library-folders\)$/)
        await expect(dialog.getByRole('heading', { name: 'Library folders' })).toBeVisible()

        await page.goBack()
        await expect(dialog).toBeHidden()
        await expect(page).toHaveURL(/\/tracks$/)
    })

    test('an old settings URL opens the dialog over Home', async ({ page }) => {
        await createRendererScenario(page, scenarioBuilder().build(), '/settings/apple-mail')
        await expect(page).toHaveURL(/\/home\(modal:settings\/apple-mail\)$/)
        const dialog = page.getByRole('dialog', { name: 'Settings' })
        await expect(dialog).toBeVisible()
        await expect(dialog.getByRole('heading', { name: 'Settings' })).toBeFocused()
    })
})
