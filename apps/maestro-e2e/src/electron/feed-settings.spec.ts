import { expect, test } from '@playwright/test'
import { mkdir } from 'node:fs/promises'
import { ElectronApplication } from 'playwright'
import { launchReleaseMaestro } from './launch-release-maestro'

let electronApp: ElectronApplication | undefined

test.afterEach(async () => {
    await electronApp?.close()
    electronApp = undefined
})

test('feed filter settings persist across app restarts', async ({}, testInfo) => {
    const appDataDir = testInfo.outputPath('app-data')
    await mkdir(appDataDir, { recursive: true })
    electronApp = await launchReleaseMaestro(appDataDir, testInfo)
    let page = await electronApp.firstWindow()
    await expect(page.getByRole('heading', { name: 'Set up your music library' })).toBeVisible()
    await page.getByRole('button', { name: 'Skip for now' }).click()
    await page.getByRole('link', { name: 'Settings', exact: true }).click()
    await page.getByRole('main').getByRole('link', { name: 'Feed', exact: true }).click()
    let filterSwitch = page.getByRole('switch', { name: 'Hide releases with no playable tracks' })
    await expect(filterSwitch).toBeChecked()
    await filterSwitch.press('Space')
    await expect(filterSwitch).not.toBeChecked()
    await page.getByRole('button', { name: 'Save', exact: true }).click()
    await expect(page.getByRole('button', { name: 'Save', exact: true })).toBeHidden()

    await electronApp.close()
    electronApp = await launchReleaseMaestro(appDataDir, testInfo)
    page = await electronApp.firstWindow()
    await expect(page).toHaveURL(/\/home$/)
    await page.getByRole('link', { name: 'Settings', exact: true }).click()
    await page.getByRole('main').getByRole('link', { name: 'Feed', exact: true }).click()
    filterSwitch = page.getByRole('switch', { name: 'Hide releases with no playable tracks' })
    await expect(filterSwitch).not.toBeChecked()
})
