import { expect, test } from '@playwright/test'
import type { AppSettings } from '@release-maestro/core'
import { createRendererScenario, scenarioBuilder } from '../scenario-harness'

const filterLabel = 'Hide releases with no playable tracks'

test('defaults to hiding unplayable releases and persists changes without replacing other settings', async ({
    page,
}) => {
    const controller = await createRendererScenario(page, scenarioBuilder().build(), '/settings/feed')
    const dialog = page.getByRole('dialog', { name: 'Settings' })
    const filterSwitch = dialog.getByRole('switch', { name: filterLabel })
    const save = dialog.getByRole('button', { name: 'Save', exact: true })
    await expect(dialog.getByRole('heading', { name: 'Feed', exact: true })).toBeVisible()
    await expect(dialog.getByRole('heading', { name: 'Release visibility' })).toBeVisible()
    await expect(filterSwitch).toBeChecked()
    await expect(filterSwitch).toHaveAccessibleDescription(/at least one track available to preview/)
    await expect(save).toBeHidden()
    await filterSwitch.focus()
    await filterSwitch.press('Space')
    await expect(filterSwitch).not.toBeChecked()
    await filterSwitch.press('Tab')
    await expect(save).toBeFocused()
    await save.press('Enter')
    await expect(save).toBeHidden()
    await expect(filterSwitch).toBeFocused()
    await expect
        .poll(() => controller.lastCall('patch-settings'))
        .toMatchObject({
            payload: { feed: { hideUnplayableReleases: false } },
        })
    await dialog.getByRole('link', { name: 'Apple Mail', exact: true }).click()
    await expect(dialog.getByRole('textbox', { name: 'Mailbox Name' })).toBeVisible()
    await dialog.getByRole('link', { name: 'Feed', exact: true }).click()
    await expect(filterSwitch).not.toBeChecked()
    await page.getByText(filterLabel, { exact: true }).click()
    await expect(filterSwitch).toBeChecked()
    await save.click()
    await expect
        .poll(() => controller.lastCall('patch-settings'))
        .toMatchObject({
            payload: { feed: { hideUnplayableReleases: true } },
        })
})

test('locks the switch while saving', async ({ page }) => {
    const controller = await createRendererScenario(
        page,
        scenarioBuilder().handler('patch-settings', { kind: 'pending' }).build(),
        '/settings/feed',
    )
    const dialog = page.getByRole('dialog', { name: 'Settings' })
    const filterSwitch = dialog.getByRole('switch', { name: filterLabel })
    await filterSwitch.click()
    await dialog.getByRole('button', { name: 'Save', exact: true }).click()

    const saving = dialog.getByRole('button', { name: 'Saving…', exact: true })
    await expect(saving).toBeDisabled()
    await expect(filterSwitch).toBeDisabled()
    await controller.resolvePending('patch-settings', {
        library: { folders: ['/scenario/music'] },
        emailPluginConfig: {},
        feed: { hideUnplayableReleases: false },
    } satisfies AppSettings)
    await expect(saving).toBeHidden()
    await expect(filterSwitch).toBeEnabled()
    await expect(filterSwitch).not.toBeChecked()
})

test('keeps unsaved changes after a failed save and supports retry', async ({ page }) => {
    const controller = await createRendererScenario(
        page,
        scenarioBuilder().handler('patch-settings', { kind: 'reject', message: 'Write failed' }).build(),
        '/settings/feed',
    )
    const dialog = page.getByRole('dialog', { name: 'Settings' })
    const filterSwitch = dialog.getByRole('switch', { name: filterLabel })
    const save = dialog.getByRole('button', { name: 'Save', exact: true })
    await filterSwitch.click()
    await expect(filterSwitch).not.toBeChecked()
    await save.focus()
    await save.press('Enter')
    await expect(dialog.getByRole('alert')).toHaveText('Could not save feed settings. Try again.')
    await expect(filterSwitch).not.toBeChecked()
    await expect(save).toBeFocused()
    await controller.setHandler('patch-settings', { kind: 'patch-settings' })
    await save.press('Enter')
    await expect(dialog.getByRole('alert')).toBeHidden()
    await expect(save).toBeHidden()
    await expect(filterSwitch).toBeFocused()
})
