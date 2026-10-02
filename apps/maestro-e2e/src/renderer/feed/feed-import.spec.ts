// Covers Bandcamp notification import progress and cancellation from the title bar and the Apple Mail
// settings page.
import { expect, test } from '@playwright/test'
import {
    createRendererScenario,
    rendererScenarios,
    RendererScenarioController,
    scenarioBuilder,
} from '../scenario-harness'

const triggerCalls = async (controller: RendererScenarioController, trigger: 'manual' | 'auto') =>
    (await controller.calls('trigger-email-import')).filter(
        call => (call.payload as { trigger?: string } | undefined)?.trigger === trigger,
    )

const appleMailSettings = (mailboxName?: string) =>
    scenarioBuilder()
        .settings({
            library: { folders: ['/scenario/music'] },
            emailPluginConfig: mailboxName ? { APPLE_MAIL: { mailboxName } } : {},
        })
        .feed([], { hasFeed: false })
        .build()

test.describe('manual import', () => {
    test('is not offered in the sidebar', async ({ page }) => {
        await createRendererScenario(page, rendererScenarios.feed.emptyNoSetup())

        await expect(page.getByRole('link', { name: 'Feed' })).toBeVisible()
        await expect(page.getByRole('complementary').getByRole('button', { name: /import/i })).toHaveCount(0)
    })

    test('starts from the Apple Mail settings and cancels there', async ({ page }) => {
        const controller = await createRendererScenario(
            page,
            appleMailSettings('Bandcamp'),
            '/settings/apple-mail',
        )
        const settingsPage = page.getByRole('main')
        const importNow = settingsPage.getByRole('button', { name: 'Import now' })

        await importNow.click()
        await expect.poll(async () => (await triggerCalls(controller, 'manual')).length).toBe(1)

        await controller.emit('email-import-progress', { phase: 'started', trigger: 'manual' })
        await expect(settingsPage.getByText('Checking mail…')).toBeVisible()
        await expect(importNow).toBeDisabled()

        await controller.emit('email-import-progress', {
            phase: 'processing',
            current: 2,
            total: 5,
            message: 'Importing Bandcamp notifications',
            trigger: 'manual',
        })
        await expect(settingsPage.getByText('Importing emails 2/5')).toBeVisible()
        // The title bar shows a manual import too, so it stays visible on other pages
        await expect(page.getByRole('banner').getByText('Importing emails 2/5')).toBeVisible()

        const cancel = settingsPage.getByRole('button', { name: 'Cancel import' })
        await cancel.focus()
        await cancel.press('Enter')
        await expect.poll(async () => controller.calls('email-import-abort')).toHaveLength(1)

        await controller.emit('email-import-progress', { phase: 'cancelled', trigger: 'manual' })
        const result = page.getByRole('status', { name: 'Last email import' })
        await expect(result).toHaveText('Last import was cancelled.')
        await expect(result).toBeFocused()
        await expect(importNow).toBeEnabled()
    })

    for (const { update, text } of [
        {
            update: { phase: 'completed', totalProcessed: 8, totalImported: 5, newlyImported: 3 },
            text: 'Last import: 8 emails processed, 3 new releases',
        },
        {
            update: { phase: 'completed', totalProcessed: 1, totalImported: 1, newlyImported: 1 },
            text: 'Last import: 1 email processed, 1 new release',
        },
        {
            update: { phase: 'error', errorMessage: 'Apple Mail export failed' },
            text: 'Last import failed: Apple Mail export failed',
        },
    ] as const) {
        test(`reports the result on the settings page, not in the title bar: ${text}`, async ({ page }) => {
            const controller = await createRendererScenario(
                page,
                appleMailSettings('Bandcamp'),
                '/settings/apple-mail',
            )

            await controller.emit('email-import-progress', { ...update, trigger: 'manual' })

            await expect(page.getByRole('status', { name: 'Last email import' })).toHaveText(text)
            await expect(page.getByRole('status', { name: 'Email import', exact: true })).toHaveText(/^\s*$/)
        })
    }

    test('needs a mailbox name to import from', async ({ page }) => {
        await createRendererScenario(page, appleMailSettings(), '/settings/apple-mail')

        await expect(page.getByRole('button', { name: 'Import now' })).toBeDisabled()
        await expect(page.getByText('Save a mailbox name to import from.')).toBeVisible()
    })

    test('imports only from the saved mailbox name', async ({ page }) => {
        await createRendererScenario(page, appleMailSettings('Bandcamp'), '/settings/apple-mail')
        const importNow = page.getByRole('button', { name: 'Import now' })
        await expect(importNow).toBeEnabled()

        await page.getByLabel('Mailbox Name').fill('Releases')

        await expect(importNow).toBeDisabled()
        await expect(page.getByText('Save the mailbox name to import from it.')).toBeVisible()
    })

    test('shows an import that was already running when the page opens', async ({ page }) => {
        const controller = await createRendererScenario(page, appleMailSettings('Bandcamp'))
        await controller.emit('email-import-progress', { phase: 'started', trigger: 'auto' })
        await expect(page.getByRole('banner').getByText('Checking mail…')).toBeVisible()

        await page.getByRole('link', { name: 'Settings', exact: true }).click()
        await page.getByRole('link', { name: 'Apple Mail' }).click()

        await expect(page.getByRole('main').getByText('Checking mail…')).toBeVisible()
        await expect(page.getByRole('button', { name: 'Import now' })).toBeDisabled()
    })
})

test.describe('auto import', () => {
    test('requests an auto import on startup', async ({ page }) => {
        const controller = await createRendererScenario(page, rendererScenarios.feed.emptyNoSetup())

        await expect.poll(async () => (await triggerCalls(controller, 'auto')).length).toBeGreaterThan(0)
    })

    test('shows auto import progress in the title bar and cancels it from there', async ({ page }) => {
        const controller = await createRendererScenario(page, rendererScenarios.feed.emptyNoSetup())
        const titleBar = page.getByRole('banner')

        await controller.emit('email-import-progress', { phase: 'started', trigger: 'auto' })
        await expect(titleBar.getByText('Checking mail…')).toBeVisible()

        await controller.emit('email-import-progress', {
            phase: 'processing',
            current: 2,
            total: 5,
            message: 'Importing Bandcamp notifications',
            trigger: 'auto',
        })
        await expect(titleBar.getByText('Importing emails 2/5')).toBeVisible()

        const cancel = page.getByRole('button', { name: 'Cancel email import' })
        await cancel.focus()
        await cancel.press('Enter')
        await expect.poll(async () => controller.calls('email-import-abort')).toHaveLength(1)

        await controller.emit('email-import-progress', { phase: 'cancelled', trigger: 'auto' })
        await expect(cancel).toBeHidden()
        await expect(titleBar).toBeFocused()
        await expect(page.getByRole('status', { name: 'Email import' })).toHaveText(/^\s*$/)
    })

    for (const { newlyImported, summary } of [
        { newlyImported: 0, summary: 'No new releases' },
        { newlyImported: 1, summary: 'Added 1 release' },
        { newlyImported: 3, summary: 'Added 3 releases' },
    ]) {
        test(`summarizes a completed auto import: ${summary}`, async ({ page }) => {
            const controller = await createRendererScenario(page, rendererScenarios.feed.emptyNoSetup())

            await controller.emit('email-import-progress', {
                phase: 'completed',
                totalProcessed: 8,
                totalImported: 5,
                newlyImported,
                trigger: 'auto',
            })

            await expect(page.getByRole('status', { name: 'Email import' })).toHaveText(summary)
        })
    }

    test('hides the auto import summary after four seconds', async ({ page }) => {
        await page.clock.install()
        const controller = await createRendererScenario(page, rendererScenarios.feed.emptyNoSetup())

        await controller.emit('email-import-progress', {
            phase: 'error',
            errorMessage: 'Apple Mail export failed',
            trigger: 'auto',
        })

        const summary = page.getByRole('status', { name: 'Email import' })
        await expect(summary).toHaveText('Email import failed')
        await page.clock.runFor(3900)
        await expect(summary).toHaveText('Email import failed')
        await page.clock.runFor(200)
        await expect(summary).toHaveText(/^\s*$/)
    })

    test('hides running progress at once on the import route', async ({ page }) => {
        await page.clock.install()
        const controller = await createRendererScenario(page, rendererScenarios.feed.emptyNoSetup())
        await controller.emit('email-import-progress', { phase: 'started', trigger: 'auto' })
        const cancel = page.getByRole('button', { name: 'Cancel email import' })
        await expect(cancel).toBeVisible()
        // Freeze time, so the phase's one-second dwell cannot run out and hide the progress anyway. The
        // slack keeps the pause target ahead of the page clock on a slow runner.
        await page.clock.pauseAt((await page.evaluate(() => Date.now())) + 300)

        // Navigate in the app, so the indicator keeps the phase it is showing
        await page.evaluate(() => {
            history.pushState({}, '', '/import')
            dispatchEvent(new PopStateEvent('popstate'))
        })
        await page.clock.runFor(200)

        await expect(page.getByRole('button', { name: 'Skip for now' })).toBeVisible()
        await expect(cancel).toBeHidden()
    })

    test('drops a summary that arrives on the import route', async ({ page }) => {
        await page.clock.install()
        const controller = await createRendererScenario(
            page,
            rendererScenarios.feed.emptyNoSetup(),
            '/import',
        )

        await controller.emit('email-import-progress', {
            phase: 'completed',
            totalProcessed: 8,
            totalImported: 5,
            newlyImported: 3,
            trigger: 'auto',
        })
        const summary = page.getByRole('status', { name: 'Email import' })
        await expect(summary).toHaveText(/^\s*$/)

        // Leaving onboarding must not surface the stale summary
        await page.getByRole('button', { name: 'Skip for now' }).click()
        await expect(page.getByRole('link', { name: 'Feed' })).toBeVisible()
        await page.clock.runFor(1000)
        // Read once: a retrying assertion would pass when the summary hides itself after four seconds
        expect((await summary.textContent())?.trim()).toBe('')
    })

    test('keeps showing an import in the title bar once a manual request takes it over', async ({ page }) => {
        const controller = await createRendererScenario(page, rendererScenarios.feed.emptyNoSetup())
        const titleBar = page.getByRole('banner')

        await controller.emit('email-import-progress', {
            phase: 'processing',
            current: 1,
            total: 5,
            message: 'Importing Bandcamp notifications',
            trigger: 'auto',
        })
        await expect(titleBar.getByText('Importing emails 1/5')).toBeVisible()

        await controller.emit('email-import-progress', {
            phase: 'processing',
            current: 2,
            total: 5,
            message: 'Importing Bandcamp notifications',
            trigger: 'manual',
        })

        await expect(titleBar.getByText('Importing emails 2/5')).toBeVisible()
        await expect(page.getByRole('button', { name: 'Cancel email import' })).toBeVisible()
    })
})
