// Covers Bandcamp notification import progress and cancellation from the title bar and the Apple Mail
// settings page.
import { expect, test } from '@playwright/test'
import { installAudioFixtureRoute } from '../../fixtures/audio.fixture'
import {
    createHydratedRelease,
    createRendererScenario,
    rendererScenarios,
    RendererScenarioController,
    scenarioBuilder,
} from '../scenario-harness'

const triggerCalls = async (controller: RendererScenarioController, trigger: 'manual' | 'auto') =>
    (await controller.calls('trigger-email-import')).filter(
        ({ payload }) =>
            typeof payload === 'object' &&
            payload !== null &&
            'trigger' in payload &&
            payload.trigger === trigger,
    )

const appleMailSettings = (mailboxName?: string) =>
    scenarioBuilder()
        .settings({
            library: { folders: ['/scenario/music'] },
            emailPluginConfig: mailboxName ? { APPLE_MAIL: { mailboxName } } : {},
        })
        .feed([], { hasFeed: false })
        .build()

test.describe('completed import feed refresh', () => {
    test.beforeEach(async ({ page }) => {
        await installAudioFixtureRoute(page)
    })

    for (const hasFeed of [false, true]) {
        for (const trigger of ['auto', 'manual'] as const) {
            test(`shows new releases after ${trigger} import while ${hasFeed ? 'caught up' : 'empty'}`, async ({
                page,
            }) => {
                const controller = await createRendererScenario(
                    page,
                    scenarioBuilder().feed([], { hasFeed }).build(),
                )
                await expect(page.getByText('No new releases')).toBeVisible()
                const release = createHydratedRelease()
                await controller.setHandler('load-feed', { kind: 'resolve', value: [release] })

                await controller.emit('email-import-progress', {
                    phase: 'completed',
                    totalProcessed: 1,
                    totalImported: 1,
                    newlyImported: 1,
                    trigger,
                })

                await expect(page.getByRole('link', { name: release.data.releaseName })).toBeVisible()
                await expect(page.getByText('No new releases')).toBeHidden()
                await expect.poll(async () => controller.calls('load-feed')).toHaveLength(2)
            })
        }
    }

    test('refreshes when an import finishes during the initial empty feed load', async ({ page }) => {
        const controller = await createRendererScenario(
            page,
            scenarioBuilder().feedLoadPending({ hasFeed: true }).build(),
        )
        await expect(page.getByText('Loading releases...')).toBeVisible()
        const release = createHydratedRelease()
        await controller.setHandler('load-feed', { kind: 'resolve', value: [release] })
        await controller.emit('email-import-progress', {
            phase: 'completed',
            totalProcessed: 1,
            totalImported: 1,
            newlyImported: 1,
            trigger: 'auto',
        })

        await controller.resolvePending('load-feed', [])

        await expect(page.getByRole('link', { name: release.data.releaseName })).toBeVisible()
        await expect.poll(async () => controller.calls('load-feed')).toHaveLength(2)
    })

    test('keeps an empty feed untouched when the import adds no releases', async ({ page }) => {
        const controller = await createRendererScenario(page, rendererScenarios.feed.emptyCaughtUp())
        await expect(page.getByText('No new releases')).toBeVisible()
        const initialLoads = await controller.calls('load-feed')

        await controller.emit('email-import-progress', {
            phase: 'completed',
            totalProcessed: 1,
            totalImported: 1,
            newlyImported: 0,
            trigger: 'auto',
        })

        await expect(page.getByRole('status', { name: 'Email import' })).toHaveText('No new releases')
        await expect(page.getByText("You're all caught up! Check back later for new releases.")).toBeVisible()
        expect(await controller.calls('load-feed')).toHaveLength(initialLoads.length)
    })

    test('preserves the active release, playback, and focus when an import adds releases', async ({
        page,
    }) => {
        const release = createHydratedRelease()
        const controller = await createRendererScenario(page, scenarioBuilder().feed([release]).build())
        await expect(page.getByRole('link', { name: release.data.releaseName })).toBeVisible()
        await page.getByRole('button', { name: 'Play Karasu' }).click()
        await expect(page.getByRole('button', { name: 'Pause Karasu' })).toBeVisible()
        const seeker = page.getByRole('button', { name: 'Seek within Karasu' })
        await seeker.focus()
        const initialLoads = await controller.calls('load-feed')
        const newlyAddedRelease = createHydratedRelease({
            id: 'newly-added-release',
            data: { ...release.data, releaseName: 'Newly added release' },
        })
        await controller.setHandler('load-feed', { kind: 'resolve', value: [newlyAddedRelease] })

        await controller.emit('email-import-progress', {
            phase: 'completed',
            totalProcessed: 1,
            totalImported: 1,
            newlyImported: 1,
            trigger: 'auto',
        })

        await expect(page.getByRole('status', { name: 'Email import' })).toHaveText('Added 1 release')
        await expect(page.getByRole('link', { name: release.data.releaseName })).toBeVisible()
        await expect(page.getByRole('link', { name: newlyAddedRelease.data.releaseName })).toHaveCount(0)
        await expect(page.getByRole('button', { name: 'Pause Karasu' })).toBeVisible()
        await expect(seeker).toBeFocused()
        expect(await controller.calls('load-feed')).toHaveLength(initialLoads.length)
        await seeker.press('O')
        await expect
            .poll(async () => controller.lastCall('open-url'))
            .toMatchObject({ payload: release.data.releaseUrl })
    })
})

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
            update: {
                phase: 'completed',
                totalProcessed: 3,
                totalImported: 1,
                newlyImported: 1,
                skippedEmails: 2,
            },
            text: "Last import: 3 emails processed, 1 new release. 2 emails couldn't be read. We'll try again next time.",
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

    for (const { newlyImported, skippedEmails, summary } of [
        { newlyImported: 1, skippedEmails: 1, summary: 'Added 1 release. 1 email will be retried.' },
        { newlyImported: 0, skippedEmails: 2, summary: '2 emails will be retried.' },
    ]) {
        test(`summarizes skipped emails calmly: ${summary}`, async ({ page }) => {
            const controller = await createRendererScenario(page, rendererScenarios.feed.emptyNoSetup())

            await controller.emit('email-import-progress', {
                phase: 'completed',
                totalProcessed: 3,
                totalImported: newlyImported,
                newlyImported,
                skippedEmails,
                trigger: 'auto',
            })

            await expect(page.getByRole('status', { name: 'Email import' })).toHaveText(summary)
            await expect(page.getByText('Email import failed')).toBeHidden()
        })
    }

    test('hides the auto import summary after four seconds', async ({ page }) => {
        await page.clock.install()
        const controller = await createRendererScenario(page, rendererScenarios.feed.emptyNoSetup())
        // Freeze before the summary arrives so assertion time cannot eat into its four seconds.
        await page.clock.pauseAt((await page.evaluate(() => Date.now())) + 1000)

        await controller.emit('email-import-progress', {
            phase: 'error',
            errorMessage: 'Apple Mail export failed',
            trigger: 'auto',
        })
        await page.clock.runFor(0)

        const summary = page.getByRole('status', { name: 'Email import' })
        await expect(summary).toHaveText('Email import failed')
        await page.clock.runFor(3900)
        await expect(summary).toHaveText('Email import failed')
        await page.clock.runFor(200)
        await expect(summary).toHaveText(/^\s*$/)
    })

    test('hides running progress at once on the import route', async ({ page }) => {
        await page.clock.install()
        // Load the lazy route before freezing time so its chunk cannot arrive after the render tick.
        const controller = await createRendererScenario(
            page,
            rendererScenarios.feed.emptyNoSetup(),
            '/import',
        )
        const skip = page.getByRole('button', { name: 'Skip for now' })
        await expect(skip).toBeVisible()
        await skip.click()
        await page.getByRole('link', { name: 'Feed', exact: true }).click()
        await expect(page.getByText('No new releases')).toBeVisible()

        // Freeze before the phase starts; both render ticks stay within its one-second dwell.
        await page.clock.pauseAt((await page.evaluate(() => Date.now())) + 1000)
        await controller.emit('email-import-progress', { phase: 'started', trigger: 'auto' })
        await page.clock.runFor(50)
        const cancel = page.getByRole('button', { name: 'Cancel email import' })
        await expect(cancel).toBeVisible()

        // Navigate in the app, so the indicator keeps the phase it is showing
        await page.evaluate(() => {
            history.pushState({}, '', '/import')
            dispatchEvent(new PopStateEvent('popstate'))
        })
        await page.clock.runFor(200)

        await expect(skip).toBeVisible()
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
