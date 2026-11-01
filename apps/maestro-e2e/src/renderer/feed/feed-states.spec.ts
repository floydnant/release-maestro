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

    test('keeps a failed release unviewed and reloads it in place from its Retry button', async ({
        page,
    }) => {
        const base = createHydratedRelease()
        const release = (id: string, releaseName: string) =>
            createHydratedRelease({ id, data: { ...base.data, releaseName } })
        const failed = createHydratedRelease({
            id: 'failed-release',
            error: { message: 'Could not reach Bandcamp' },
            data: { ...base.data, releaseName: 'Failed release', tracks: [] },
        })
        const controller = await createRendererScenario(
            page,
            scenarioBuilder()
                .feed([
                    failed,
                    release('second-release', 'Second release'),
                    release('third-release', 'Third release'),
                    release('fourth-release', 'Fourth release'),
                ])
                .handler('reload-feed-items', { kind: 'pending' })
                .build(),
        )
        await expect(page.getByText('Could not reach Bandcamp')).toBeVisible()

        // Visit both cards, then leave them: only the healthy release should be marked viewed.
        // The observer watches the whole card, so seeing its title alone is not enough.
        const retry = page.getByRole('button', { name: 'Retry loading Failed release' })
        const failedCard = page.locator('.feed-entry').filter({ has: retry })
        await failedCard.scrollIntoViewIfNeeded()
        await expect(failedCard).toBeInViewport({ ratio: 1 })
        const second = page.locator('.feed-entry').filter({
            has: page.getByRole('link', { name: 'Second release', exact: true }),
        })
        await second.scrollIntoViewIfNeeded()
        await expect(second).toBeInViewport({ ratio: 1 })
        const fourth = page.locator('.feed-entry').filter({
            has: page.getByRole('link', { name: 'Fourth release', exact: true }),
        })
        await fourth.scrollIntoViewIfNeeded()
        await expect(fourth).toBeInViewport({ ratio: 1 })
        await expect(second).not.toBeInViewport()
        await expect(failedCard).not.toBeInViewport()
        await expect
            .poll(async () => (await controller.calls('mark-feed-item-viewed')).map(({ payload }) => payload))
            .toContainEqual(expect.objectContaining({ id: 'second-release' }))
        expect(await controller.calls('mark-feed-item-viewed')).not.toContainEqual(
            expect.objectContaining({ payload: expect.objectContaining({ id: 'failed-release' }) }),
        )

        await retry.click()
        await expect(page.getByText('Retrying', { exact: true })).toBeVisible()
        await expect(retry).toBeDisabled()
        expect(await controller.lastCall('reload-feed-items')).toMatchObject({
            payload: { ids: ['failed-release'] },
        })

        await controller.resolvePending('reload-feed-items', [release('failed-release', 'Failed release')])

        await expect(page.getByText('Could not reach Bandcamp')).toBeHidden()
        await expect(page.getByRole('link', { name: 'Failed release' })).toBeVisible()
        expect(await controller.calls('reload-feed-items')).toHaveLength(1)
    })

    test('keeps keyboard focus when a release retry fails again', async ({ page }) => {
        const base = createHydratedRelease()
        const failed = createHydratedRelease({
            id: 'keyboard-retry',
            error: { message: 'Could not reach Bandcamp' },
            data: { ...base.data, releaseName: 'Keyboard release', tracks: [] },
        })
        const controller = await createRendererScenario(
            page,
            scenarioBuilder().feed([failed]).handler('reload-feed-items', { kind: 'pending' }).build(),
        )
        const retry = page.getByRole('button', { name: 'Retry loading Keyboard release' })
        await retry.focus()
        await retry.press('Enter')
        await expect(retry).toBeDisabled()
        await expect(retry).toBeFocused()
        await retry.press('Enter')
        await expect.poll(async () => (await controller.calls('reload-feed-items')).length).toBe(1)

        await controller.resolvePending('reload-feed-items', [failed])
        await expect(retry).toBeEnabled()
        await expect(retry).toBeFocused()
        await retry.press('Enter')
        await expect.poll(async () => (await controller.calls('reload-feed-items')).length).toBe(2)
        await controller.resolvePending('reload-feed-items', [{ ...failed, error: null, data: base.data }])
        await expect(retry).toBeHidden()
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
