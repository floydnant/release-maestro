import { expect, test } from '@playwright/test'
import type { AppSettings } from '@release-maestro/core'
import { createRendererScenario, scenarioBuilder } from '../scenario-harness'

const filterLabel = 'Hide releases with no playable tracks'
const snoozeLabel = 'Snooze duration hours'

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
    await expect(dialog.getByRole('spinbutton', { name: snoozeLabel })).toBeFocused()
    await page.keyboard.press('Tab')
    await expect(save).toBeFocused()
    await save.press('Enter')
    await expect(save).toBeHidden()
    await expect(filterSwitch).toBeFocused()
    await expect
        .poll(async () => (await controller.lastCall('patch-settings'))?.payload)
        .toEqual({ feed: { hideUnplayableReleases: false } })
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

test('saves snooze hours to two decimals and blocks other entries', async ({ page }) => {
    const controller = await createRendererScenario(page, scenarioBuilder().build(), '/settings/feed')
    const dialog = page.getByRole('dialog', { name: 'Settings' })
    const snoozeHours = dialog.getByRole('spinbutton', { name: snoozeLabel })
    const save = dialog.getByRole('button', { name: 'Save', exact: true })
    const rangeError = dialog.getByRole('alert').filter({ hasText: 'with at most two decimal places' })
    await expect(dialog.getByRole('heading', { name: 'Snooze' })).toBeVisible()
    await expect(snoozeHours).toHaveValue('16')
    await expect(snoozeHours).toHaveAccessibleDescription(/returns to your feed this many hours/)
    await expect(save).toBeHidden()

    await snoozeHours.fill('')
    await snoozeHours.pressSequentially('1e')
    await expect(rangeError).toBeVisible()
    expect(await snoozeHours.evaluate((field: HTMLInputElement) => field.validity.badInput)).toBe(true)

    for (const invalid of ['0', '169', '1.555', '']) {
        await snoozeHours.fill(invalid)
        await expect(rangeError).toHaveText('Enter 1 to 168 hours, with at most two decimal places.')
        await expect(snoozeHours).toHaveAttribute('aria-invalid', 'true')
        await expect(save).toBeDisabled()
    }

    await snoozeHours.fill('24.5')
    await expect(rangeError).toBeHidden()
    await expect(snoozeHours).toHaveAttribute('aria-invalid', 'false')
    await save.click()
    await expect(save).toBeHidden()
    await expect(snoozeHours).toBeFocused()
    await expect
        .poll(async () => (await controller.lastCall('patch-settings'))?.payload)
        .toEqual({ feed: { snoozeHours: 24.5 } })
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
