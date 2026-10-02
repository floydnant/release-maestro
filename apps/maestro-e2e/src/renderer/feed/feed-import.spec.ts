// Covers Bandcamp notification import progress and cancellation from the release feed shell.
import { expect, test } from '@playwright/test'
import { createRendererScenario, rendererScenarios, RendererScenarioController } from '../scenario-harness'

const triggerCalls = async (controller: RendererScenarioController, trigger: 'manual' | 'auto') =>
    (await controller.calls('trigger-email-import')).filter(
        call => (call.payload as { trigger?: string } | undefined)?.trigger === trigger,
    )

test.describe('release feed import scenarios', () => {
    test('emits import progress events and records cancel IPC calls', async ({ page }) => {
        const controller = await createRendererScenario(page, rendererScenarios.feed.emptyNoSetup())

        await page.getByRole('button', { name: 'Import Emails' }).click()
        await expect.poll(async () => (await triggerCalls(controller, 'manual')).length).toBe(1)

        await controller.emit('email-import-progress', {
            phase: 'processing',
            current: 2,
            total: 5,
            message: 'Importing Bandcamp notifications',
            trigger: 'manual',
        })

        await expect(page.getByText('Importing Bandcamp notifications')).toBeVisible()
        await expect(page.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '40')

        await page.getByRole('button', { name: 'Cancel' }).click()

        await expect.poll(async () => controller.calls('email-import-abort')).toHaveLength(1)
    })

    test('shows a cancellable manual import before the first email arrives', async ({ page }) => {
        const controller = await createRendererScenario(page, rendererScenarios.feed.emptyNoSetup())

        await controller.emit('email-import-progress', { phase: 'started', trigger: 'manual' })

        await expect(page.getByRole('complementary').getByText('Checking mail…')).toBeVisible()
        await expect(page.getByRole('button', { name: 'Import Emails' })).toBeHidden()
        await page.getByRole('button', { name: 'Cancel', exact: true }).click()
        await expect.poll(async () => controller.calls('email-import-abort')).toHaveLength(1)

        await controller.emit('email-import-progress', { phase: 'cancelled', trigger: 'manual' })
        await expect(page.getByRole('button', { name: 'Import Emails' })).toBeVisible()
    })

    test('renders completed import results and returns to the idle import action', async ({ page }) => {
        const controller = await createRendererScenario(page, rendererScenarios.feed.emptyNoSetup())

        await expect(page.getByRole('button', { name: 'Import Emails' })).toBeVisible()

        await controller.emit('email-import-progress', {
            phase: 'completed',
            totalProcessed: 8,
            totalImported: 5,
            newlyImported: 3,
            trigger: 'manual',
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
            trigger: 'manual',
        })

        await expect(page.getByText('Apple Mail export failed')).toBeVisible()

        await page.getByRole('button', { name: 'Retry' }).click()

        await expect.poll(async () => (await triggerCalls(controller, 'manual')).length).toBe(1)
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
        // The sidebar stays on the import action and does not show the auto import
        await expect(page.getByRole('button', { name: 'Import Emails' })).toBeVisible()
        await expect(page.getByText('Importing Bandcamp notifications')).toBeHidden()

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

    test('moves an import to the sidebar once a manual request takes it over', async ({ page }) => {
        const controller = await createRendererScenario(page, rendererScenarios.feed.emptyNoSetup())

        await controller.emit('email-import-progress', {
            phase: 'processing',
            current: 1,
            total: 5,
            message: 'Importing Bandcamp notifications',
            trigger: 'auto',
        })
        await expect(page.getByRole('button', { name: 'Cancel email import' })).toBeVisible()

        await controller.emit('email-import-progress', {
            phase: 'processing',
            current: 2,
            total: 5,
            message: 'Importing Bandcamp notifications',
            trigger: 'manual',
        })

        await expect(page.getByText('Importing Bandcamp notifications')).toBeVisible()
        await expect(page.getByRole('button', { name: 'Cancel email import' })).toBeHidden()
    })
})
