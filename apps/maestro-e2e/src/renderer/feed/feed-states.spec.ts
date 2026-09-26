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

    test('keeps a long release title and the label within the feed', async ({ page }) => {
        const baseRelease = createHydratedRelease()
        const title = 'Supercalifragilisticexpialidocious'.repeat(12)
        const release = createHydratedRelease({
            data: { ...baseRelease.data, releaseName: title },
        })
        await createRendererScenario(page, scenarioBuilder().feed([release]).build())

        const titleLink = page.getByRole('link', { name: title })
        const label = page.getByText('Shiva Chandra', { exact: true })
        await expect(titleLink).toBeVisible()
        await expect(label).toBeVisible()

        for (const width of [1280, 900]) {
            await page.setViewportSize({ width, height: 720 })
            await expect
                .poll(async () => {
                    const titleBounds = await titleLink.boundingBox()
                    const labelBounds = await label.boundingBox()
                    return Boolean(
                        titleBounds &&
                        labelBounds &&
                        titleBounds.x + titleBounds.width <= labelBounds.x &&
                        labelBounds.x + labelBounds.width <= width,
                    )
                })
                .toBe(true)
        }
    })

    test('keeps feed content within its columns when metadata is long', async ({ page }) => {
        const baseRelease = createHydratedRelease()
        const longWord = 'Puffycon'.repeat(24)
        const previewTitle = `Preview${longWord}`
        const playableTrackTitle = `PlayableTrack${longWord}`
        const unavailableTrackTitle = `UnavailableTrack${longWord}`
        const labelLinkText = `LabelLink${longWord}`
        const release = createHydratedRelease({
            error: { message: `Error${longWord}` },
            data: {
                ...baseRelease.data,
                artist: `Artist${longWord}`,
                about: `<p>About${longWord}</p><p><a href="https://example.com">AboutLink${longWord}</a></p>`,
                links: [
                    { title: previewTitle, favicon: baseRelease.data.imageUrl, url: 'https://example.com' },
                ],
                tracks: baseRelease.data.tracks.flatMap(track => [
                    { ...track, title: playableTrackTitle },
                    { ...track, title: unavailableTrackTitle, streamUrl: null },
                ]),
                band: {
                    name: `Label${longWord}`,
                    imageUrl: null,
                    location: `Location${longWord}`,
                    bio: `Bio${longWord}`,
                    links: [{ url: 'https://example.com', text: labelLinkText }],
                },
            },
        })
        await createRendererScenario(page, scenarioBuilder().feed([release]).build())

        const titleLink = page.getByRole('link', { name: release.data.releaseName })
        const previewLink = page.getByRole('link', { name: previewTitle })
        const labelLink = page.getByRole('link', { name: labelLinkText })
        await expect(titleLink).toBeVisible()
        await expect(previewLink).toBeVisible()
        await expect(
            page.getByRole('button', { name: `Seek within ${playableTrackTitle}` }).locator('span.truncate'),
        ).toHaveAttribute('title', playableTrackTitle)
        await expect(page.getByText(unavailableTrackTitle)).toHaveAttribute('title', unavailableTrackTitle)
        await expect(previewLink).toHaveAttribute('title', `${previewTitle}\nhttps://example.com`)
        await expect(labelLink).toHaveAttribute('title', `${labelLinkText}\nhttps://example.com`)

        for (const width of [1280, 960]) {
            await page.setViewportSize({ width, height: 720 })
            await expect
                .poll(async () =>
                    titleLink.evaluate(link => {
                        const entry = link.closest('.feed-entry')
                        const selectors = ['.feed-entry', '.text-column > div', '.label-column', '.tracks']
                        return selectors.flatMap(selector => {
                            const element =
                                selector === '.feed-entry' ? entry : entry?.querySelector(selector)
                            return element && element.scrollWidth > element.clientWidth + 1
                                ? [`${selector}: ${element.scrollWidth}/${element.clientWidth}`]
                                : []
                        })
                    }),
                )
                .toEqual([])

            await expect
                .poll(async () =>
                    previewLink.evaluate(link => {
                        const column = link.closest('.text-column')
                        return Boolean(
                            column &&
                            link.getBoundingClientRect().right <= column.getBoundingClientRect().right,
                        )
                    }),
                )
                .toBe(true)
            await expect
                .poll(async () =>
                    page
                        .getByRole('img', { name: `Favicon for ${previewTitle}` })
                        .evaluate(icon => icon.getBoundingClientRect().width),
                )
                .toBe(16)
        }
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
