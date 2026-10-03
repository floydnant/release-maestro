import { expect, test } from '@playwright/test'
import { createRendererScenario, scenarioBuilder } from '../scenario-harness'

const filterLabel = 'Hide releases with no playable tracks'

test('defaults to hiding unplayable releases and persists changes without replacing other settings', async ({
    page,
}) => {
    const controller = await createRendererScenario(page, scenarioBuilder().build(), '/settings/feed')
    const checkbox = page.getByRole('checkbox', { name: filterLabel })
    await expect(checkbox).toBeChecked()
    await checkbox.focus()
    await checkbox.press('Space')
    await expect(checkbox).not.toBeChecked()
    await checkbox.press('Tab')
    await page.getByRole('button', { name: 'Save', exact: true }).press('Enter')
    await expect(page.getByRole('button', { name: 'Save', exact: true })).toBeHidden()
    await expect(checkbox).toBeFocused()
    await expect
        .poll(() => controller.lastCall('patch-settings'))
        .toMatchObject({
            payload: { feed: { hideUnplayableReleases: false } },
        })
    await page.getByRole('link', { name: 'Apple Mail', exact: true }).click()
    await expect(page.getByLabel('Mailbox Name')).toBeVisible()
    await page.getByRole('main').getByRole('link', { name: 'Feed', exact: true }).click()
    await expect(checkbox).not.toBeChecked()
    await checkbox.check()
    await page.getByRole('button', { name: 'Save', exact: true }).click()
    await expect
        .poll(() => controller.lastCall('patch-settings'))
        .toMatchObject({
            payload: { feed: { hideUnplayableReleases: true } },
        })
})

test('keeps unsaved changes after a failed save and supports retry', async ({ page }) => {
    const controller = await createRendererScenario(
        page,
        scenarioBuilder().handler('patch-settings', { kind: 'reject', message: 'Write failed' }).build(),
        '/settings/feed',
    )
    const checkbox = page.getByRole('checkbox', { name: filterLabel })
    await checkbox.uncheck()
    await page.getByRole('button', { name: 'Save', exact: true }).click()
    await expect(page.getByRole('alert')).toHaveText('Could not save feed settings. Try again.')
    await expect(checkbox).not.toBeChecked()
    await controller.setHandler('patch-settings', { kind: 'patch-settings' })
    await page.getByRole('button', { name: 'Save', exact: true }).click()
    await expect(page.getByRole('alert')).toBeHidden()
    await expect(page.getByRole('button', { name: 'Save', exact: true })).toBeHidden()
})
