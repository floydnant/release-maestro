import { expect, test } from '@playwright/test'
import { createRendererScenario, scenarioBuilder } from '../scenario-harness'

test.describe('settings dialog', () => {
    test('opens over the current page and returns focus when dismissed', async ({ page }) => {
        await createRendererScenario(page, scenarioBuilder().build(), '/tracks')
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
        await expect(page.getByRole('dialog', { name: 'Settings' })).toBeVisible()
    })
})
