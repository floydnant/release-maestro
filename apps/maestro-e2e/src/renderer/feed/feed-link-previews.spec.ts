// Covers link previews that fill in after the release feed has rendered.
import { expect, test } from '@playwright/test'
import { HydratedFeedItem, ScrapedLinkMetadata } from '@release-maestro/core'
import { coverArtDataUrl } from '../../fixtures/cover-art.fixture'
import {
    createHydratedRelease,
    createRendererScenario,
    RendererScenarioController,
    scenarioBuilder,
} from '../scenario-harness'

const MERCH_URL = 'https://shivachandra.bandcamp.com/merch'
const WEBSITE_URL = 'https://shivachandra.example/'
const LABEL_URL = 'https://label.example/shop'

const withLinks = (release: HydratedFeedItem, urls: string[]): HydratedFeedItem => ({
    ...release,
    data: { ...release.data, links: urls.map(url => ({ url, title: url, favicon: undefined })) },
})

const createPreview = (url: string, title: string): ScrapedLinkMetadata => ({
    url,
    title,
    description: null,
    image: null,
    favicon: coverArtDataUrl(title),
})

const linkPreviewCalls = async (controller: RendererScenarioController) =>
    (await controller.calls('load-link-previews')).map(call => call.payload)

test.describe('release feed link previews', () => {
    test('shows the release before its link previews and fills them in when they arrive', async ({
        page,
    }) => {
        const release = withLinks(createHydratedRelease(), [MERCH_URL, WEBSITE_URL])
        const controller = await createRendererScenario(
            page,
            scenarioBuilder().feed([release]).handler('load-link-previews', { kind: 'pending' }).build(),
        )

        await expect(page.getByRole('link', { name: release.data.releaseName })).toBeVisible()
        await expect(page.getByRole('button', { name: 'Play Karasu' })).toBeVisible()
        await expect(page.getByRole('link', { name: MERCH_URL })).toBeVisible()
        await expect.poll(() => linkPreviewCalls(controller)).toEqual([{ urls: [MERCH_URL, WEBSITE_URL] }])

        const merchPreview = createPreview(MERCH_URL, 'Merch | Shiva Chandra')
        await controller.resolvePending('load-link-previews', { [MERCH_URL]: merchPreview })

        const merchLink = page.getByRole('link', { name: 'Merch | Shiva Chandra' })
        await expect(merchLink).toHaveAttribute('href', MERCH_URL)
        await expect(merchLink).toHaveAttribute('target', '_blank')
        await expect(page.getByRole('img', { name: 'Favicon for Merch | Shiva Chandra' })).toHaveAttribute(
            'src',
            merchPreview.favicon,
        )
        // A link without a preview keeps its URL as the title.
        await expect(page.getByRole('link', { name: WEBSITE_URL })).toBeVisible()

        await merchLink.hover()
        await expect(page.getByRole('tooltip')).toContainText('Merch | Shiva Chandra')
        await expect(page.getByRole('tooltip')).toContainText(MERCH_URL)
    })

    test('keeps the feed usable and loads later previews when one batch fails', async ({ page }) => {
        const first = withLinks(createHydratedRelease({ id: 'release-first' }), [MERCH_URL])
        const secondBase = createHydratedRelease({ id: 'release-second' })
        const second = withLinks(
            { ...secondBase, data: { ...secondBase.data, releaseName: 'Second Gecko' } },
            [LABEL_URL],
        )
        const controller = await createRendererScenario(
            page,
            scenarioBuilder()
                .feed([first, second])
                .handler('load-link-previews', {
                    kind: 'sequence',
                    steps: [
                        { kind: 'reject', message: 'Preview lookup failed' },
                        { kind: 'resolve', value: { [LABEL_URL]: createPreview(LABEL_URL, 'Label Shop') } },
                    ],
                })
                .build(),
        )

        await expect(page.getByRole('link', { name: 'Label Shop' })).toHaveAttribute('href', LABEL_URL)
        await expect
            .poll(() => linkPreviewCalls(controller))
            .toEqual([{ urls: [MERCH_URL] }, { urls: [LABEL_URL] }])
        await expect(page.getByRole('link', { name: MERCH_URL })).toHaveAttribute('href', MERCH_URL)
        await expect(page.getByRole('link', { name: first.data.releaseName, exact: true })).toBeVisible()
        await expect(page.getByRole('button', { name: 'Play Karasu' }).first()).toBeVisible()
        await expect(page.getByText('Failed to load')).toBeHidden()
    })

    test('requests each link once, one release at a time in feed order', async ({ page }) => {
        const first = withLinks(createHydratedRelease({ id: 'release-first' }), [MERCH_URL, WEBSITE_URL])
        const secondBase = createHydratedRelease({ id: 'release-second' })
        const second = withLinks(
            { ...secondBase, data: { ...secondBase.data, releaseName: 'Second Gecko' } },
            [WEBSITE_URL, LABEL_URL],
        )
        const controller = await createRendererScenario(
            page,
            scenarioBuilder()
                .feed([first, second])
                .handler('load-link-previews', { kind: 'pending' })
                .build(),
        )

        await expect(page.getByRole('link', { name: 'Second Gecko' })).toBeVisible()
        await expect.poll(() => linkPreviewCalls(controller)).toEqual([{ urls: [MERCH_URL, WEBSITE_URL] }])

        await controller.resolvePending('load-link-previews', {
            [WEBSITE_URL]: createPreview(WEBSITE_URL, 'Shiva Chandra Official'),
        })
        // The shared website link fills in on both releases from the first answer.
        await expect(page.getByRole('link', { name: 'Shiva Chandra Official' })).toHaveCount(2)
        await expect
            .poll(() => linkPreviewCalls(controller))
            .toEqual([{ urls: [MERCH_URL, WEBSITE_URL] }, { urls: [LABEL_URL] }])

        await controller.resolvePending('load-link-previews', {
            [LABEL_URL]: createPreview(LABEL_URL, 'Label Shop'),
        })
        await expect(page.getByRole('link', { name: 'Label Shop' })).toHaveAttribute('href', LABEL_URL)
    })
})
