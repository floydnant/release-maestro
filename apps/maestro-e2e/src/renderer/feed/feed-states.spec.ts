// Covers release feed loading, empty, error, retry, and populated mocked IPC states.
import { expect, test } from '@playwright/test'
import {
    createHydratedRelease,
    createRendererScenario,
    rendererScenarios,
    scenarioBuilder,
} from '../scenario-harness'

test.describe('release feed scenario states', () => {
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

    test('updates a failed release feed scenario with a new handler before retrying', async ({ page }) => {
        const release = createHydratedRelease({ id: 'release-after-handler-update' })
        const controller = await createRendererScenario(page, rendererScenarios.feed.loadError())

        await expect(page.getByText('Could not load releases')).toBeVisible()
        await controller.setHandler('load-feed', { kind: 'resolve', value: [release] })
        await page.getByRole('button', { name: 'Retry' }).click()

        await expect(page.getByRole('link', { name: release.data.releaseName })).toBeVisible()
    })
})
