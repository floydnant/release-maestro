import { expect, test } from '@playwright/test'
import {
    createHydratedRelease,
    createRendererScenario,
    rendererScenarios,
    scenarioBuilder,
} from './scenario-harness'

test.describe('renderer scenario E2E', () => {
    test('renders the release feed loading state while feed loading is pending', async ({ page }) => {
        const release = createHydratedRelease({ id: 'release-after-pending' })
        const controller = await createRendererScenario(page, scenarioBuilder().feedLoadPending().build())

        await expect(page.getByText('Loading releases...')).toBeVisible()
        await controller.resolvePending('load-feed', [release])
        await expect(page.getByRole('link', { name: release.data.releaseName })).toBeVisible()
    })

    test('renders the empty setup state when the release feed has never been imported', async ({ page }) => {
        await createRendererScenario(page, rendererScenarios.feed.emptyNoSetup())

        await expect(page.getByText('No new releases')).toBeVisible()
        await expect(page.getByText("It looks like you haven't set up your feed yet.")).toBeVisible()
        await expect(page.getByRole('link', { name: 'settings', exact: true })).toBeVisible()
    })

    test('renders the caught-up state when the release feed exists but has no new releases', async ({
        page,
    }) => {
        await createRendererScenario(page, rendererScenarios.feed.emptyCaughtUp())

        await expect(page.getByText('No new releases')).toBeVisible()
        await expect(page.getByText("You're all caught up! Check back later for new releases.")).toBeVisible()
    })

    test('renders a recoverable error when checking whether an empty feed has been set up fails', async ({
        page,
    }) => {
        await createRendererScenario(
            page,
            scenarioBuilder()
                .handler('load-feed', { kind: 'resolve', value: [] })
                .handler('has-feed', {
                    kind: 'reject',
                    message: 'Feed setup query timed out',
                    userFacingMessage: 'Could not check whether your feed is set up. Please try again.',
                })
                .build(),
        )

        await expect(
            page.getByText('Could not check whether your feed is set up. Please try again.'),
        ).toBeVisible()
        await expect(page.getByRole('button', { name: 'Retry' })).toBeVisible()
    })

    test('renders a feed load error and recovers on retry', async ({ page }) => {
        const release = createHydratedRelease({ id: 'release-after-retry' })
        const controller = await createRendererScenario(page, rendererScenarios.feed.loadError())

        await expect(page.getByText('Could not load releases')).toBeVisible()
        await controller.updateState({
            'load-feed': {
                kind: 'sequence',
                steps: [{ kind: 'resolve', value: [release] }],
                fallback: { kind: 'resolve', value: [release] },
            },
        })
        await page.getByRole('button', { name: 'Retry' }).click()

        await expect(page.getByRole('link', { name: release.data.releaseName })).toBeVisible()
    })

    test('renders a populated release feed from mocked IPC state', async ({ page }) => {
        const release = createHydratedRelease()
        const controller = await createRendererScenario(page, scenarioBuilder().feed([release]).build())

        await expect(page.getByRole('link', { name: release.data.releaseName })).toBeVisible()
        await expect(page.getByText(`by ${release.data.artist}`)).toBeVisible()

        await expect
            .poll(async () => controller.lastCall('load-feed'))
            .toMatchObject({ channel: 'load-feed', payload: { index: 0, count: 5 } })
    })

    test('plays and seeks a real preview stream', async ({ page }) => {
        const release = createHydratedRelease()

        await createRendererScenario(page, scenarioBuilder().feed([release]).build())

        await page.getByRole('button', { name: 'Play Karasu' }).click()
        await expect(page.getByRole('button', { name: 'Pause Karasu' })).toBeVisible()

        const progress = page.getByRole('progressbar', { name: 'Karasu playback progress' })
        await expect
            .poll(async () => Number((await progress.getAttribute('aria-valuemax')) ?? 0), {
                timeout: 15_000,
            })
            .toBeGreaterThan(1)

        const seeker = page.getByRole('button', { name: 'Seek within Karasu' })
        const seekerBox = await seeker.boundingBox()
        // eslint-disable-next-line playwright/no-conditional-in-test
        if (!seekerBox) throw new Error('Track seeker was not rendered')

        await seeker.click({
            position: {
                x: seekerBox.width * 0.8,
                y: seekerBox.height / 2,
            },
        })

        await expect
            .poll(async () => {
                const currentTime = Number((await progress.getAttribute('aria-valuenow')) ?? 0)
                const duration = Number((await progress.getAttribute('aria-valuemax')) ?? 1)
                return currentTime / duration
            })
            .toBeGreaterThan(0.7)
    })

    test('updates a failed release feed scenario with a new handler before retrying', async ({ page }) => {
        const release = createHydratedRelease({ id: 'release-after-handler-update' })
        const controller = await createRendererScenario(page, rendererScenarios.feed.loadError())

        await expect(page.getByText('Could not load releases')).toBeVisible()
        await controller.setHandler('load-feed', { kind: 'resolve', value: [release] })
        await page.getByRole('button', { name: 'Retry' }).click()

        await expect(page.getByRole('link', { name: release.data.releaseName })).toBeVisible()
    })

    test('loads and saves settings through configured IPC handlers', async ({ page }) => {
        const scenario = scenarioBuilder()
            .settings({ emailPluginConfig: { APPLE_MAIL: { mailboxName: 'Bandcamp Inbox' } } })
            .handler('set-settings', { kind: 'resolve' })
            .build()
        const controller = await createRendererScenario(page, scenario, '/settings/apple-mail')

        const mailboxInput = page.getByLabel('Mailbox Name')
        await expect(mailboxInput).toHaveValue('Bandcamp Inbox')

        await mailboxInput.fill('New Releases')
        await page.getByRole('button', { name: 'Save' }).click()

        await expect
            .poll(async () => controller.lastCall('set-settings'))
            .toMatchObject({
                channel: 'set-settings',
                payload: { emailPluginConfig: { APPLE_MAIL: { mailboxName: 'New Releases' } } },
            })
    })

    test('emits import progress events and records cancel IPC calls', async ({ page }) => {
        const controller = await createRendererScenario(page, rendererScenarios.feed.emptyNoSetup())

        await page.getByRole('button', { name: 'Import Emails' }).click()
        await expect
            .poll(async () => controller.lastCall('trigger-email-import'))
            .toMatchObject({ channel: 'trigger-email-import' })

        await controller.emit('email-import-progress', {
            phase: 'processing',
            current: 2,
            total: 5,
            message: 'Importing Bandcamp notifications',
        })

        await expect(page.getByText('Importing Bandcamp notifications')).toBeVisible()
        await expect(page.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '40')

        await page.getByRole('button', { name: 'Cancel' }).click()

        await expect.poll(async () => controller.calls('email-import-abort')).toHaveLength(1)
    })

    test('supports one-shot renderer event listeners', async ({ page }) => {
        const controller = await createRendererScenario(page, rendererScenarios.feed.emptyNoSetup())

        await page.evaluate(() => {
            const electronModule = window.require?.('electron') as {
                ipcRenderer: {
                    once: (channel: string, listener: () => void) => void
                }
            }
            let listenerCallCount = 0
            electronModule.ipcRenderer.once('email-import-progress', () => {
                listenerCallCount += 1
            })
            ;(
                window as unknown as { __scenarioOnceListenerCallCount: () => number }
            ).__scenarioOnceListenerCallCount = () => listenerCallCount
        })

        await controller.emit('email-import-progress', {
            phase: 'processing',
            current: 1,
            total: 2,
            message: 'First event',
        })
        await controller.emit('email-import-progress', {
            phase: 'processing',
            current: 2,
            total: 2,
            message: 'Second event',
        })

        await expect
            .poll(() =>
                page.evaluate(() =>
                    (
                        window as unknown as { __scenarioOnceListenerCallCount: () => number }
                    ).__scenarioOnceListenerCallCount(),
                ),
            )
            .toBe(1)
    })
})
