// Covers the fans-who-bought avatar stacks on a release and beside each of its tracks.
import { expect, type Page, test } from '@playwright/test'
import { BandcampFan, HydratedFeedItem } from '@release-maestro/core'
import { installAudioFixtureRoute } from '../../fixtures/audio.fixture'
import {
    createBandcampFan,
    createHydratedRelease,
    createRendererScenario,
    scenarioBuilder,
} from '../scenario-harness'

const adam = createBandcampFan('Adam Pitts')
const maya = createBandcampFan('Maya')
const river = createBandcampFan('River & Rain')

/** A three-track album whose tracks were bought by the given fans, track by track. */
const createPurchasedAlbum = (
    trackFans: [BandcampFan[], BandcampFan[], BandcampFan[]],
    overrides: Partial<HydratedFeedItem> = {},
): HydratedFeedItem => {
    const base = createHydratedRelease()
    const [template] = base.data.tracks
    if (!template) throw new Error('The release fixture has no track')
    const titles = ['Karasu', 'Tsubame', 'Hibari']
    const tracks = trackFans.map((fans, index) => ({
        ...template,
        id: index + 1,
        title: titles[index] ?? `Track ${index + 1}`,
        fans,
    }))
    const fans = [...new Map(trackFans.flat().map(fan => [fan.profileUrl, fan])).values()]
    return createHydratedRelease({ ...overrides, data: { ...base.data, fans, tracks, ...overrides.data } })
}

const openFeed = async (page: Page, release: HydratedFeedItem) => {
    await installAudioFixtureRoute(page)
    await createRendererScenario(page, scenarioBuilder().feed([release]).build())
    await expect(page.getByRole('link', { name: release.data.releaseName })).toBeVisible()
}

const trackRow = (page: Page, index: number) => page.locator(`.track[data-track-index="${index}"]`)
const releaseStack = (page: Page) => page.locator('.text-column .fan-avatar-stack')

test.describe('release feed fan purchases', () => {
    test('credits a fan who bought the whole album on the release and every track', async ({ page }) => {
        await openFeed(page, createPurchasedAlbum([[adam], [adam], [adam]]))

        await expect(page.locator('.fan-summary')).toHaveText('Bought by Adam Pitts')
        await expect(page.getByRole('img', { name: 'Bought by Adam Pitts', exact: true })).toHaveCount(4)
        for (const index of [0, 1, 2]) {
            await expect(
                trackRow(page, index).getByRole('img', { name: 'Bought by Adam Pitts' }),
            ).toBeVisible()
        }
        // Names appear only in the release summary, never inline on a track.
        await expect(page.getByText('Adam Pitts', { exact: true })).toHaveCount(0)
        await expect(page.getByText('Bought by fans you follow')).toHaveCount(0)
    })

    test('shows each track’s own buyers and keeps durations aligned', async ({ page }) => {
        await openFeed(page, createPurchasedAlbum([[adam, maya], [], [adam, river]]))

        await expect(page.locator('.fan-summary')).toHaveText('Bought by 3 fans you follow')
        await expect(
            page.getByRole('img', {
                name: 'Bought by 3 fans you follow: Adam Pitts, Maya, and River & Rain',
            }),
        ).toBeVisible()
        await expect(trackRow(page, 0).getByRole('img')).toHaveAccessibleName('Bought by Adam Pitts and Maya')
        await expect(trackRow(page, 1).getByRole('img')).toHaveCount(0)
        await expect(trackRow(page, 2).getByRole('img')).toHaveAccessibleName(
            'Bought by Adam Pitts and River & Rain',
        )

        const seekerEdges = await page
            .getByRole('button', { name: /^Seek within / })
            .evaluateAll(seekers => seekers.map(seeker => Math.round(seeker.getBoundingClientRect().right)))
        expect(new Set(seekerEdges).size).toBe(1)
    })

    test('keeps playback and seeking on the track beside its buyers', async ({ page }) => {
        await openFeed(page, createPurchasedAlbum([[adam, maya], [maya], [river]]))
        const row = trackRow(page, 0)

        // The stack is a sibling of the track controls, not nested inside them.
        await expect(row.getByRole('button', { name: 'Play Karasu' }).getByRole('img')).toHaveCount(0)
        await expect(row.getByRole('button', { name: 'Seek within Karasu' }).getByRole('img')).toHaveCount(0)

        await row.getByRole('img', { name: 'Bought by Adam Pitts and Maya' }).click()
        await expect(page.getByRole('button', { name: 'Play Karasu' })).toBeVisible()

        await row.getByRole('button', { name: 'Play Karasu' }).click()
        await expect(page.getByRole('button', { name: 'Pause Karasu' })).toBeVisible()
    })

    test('reveals buyers on keyboard focus, after the track controls', async ({ page }) => {
        await openFeed(page, createPurchasedAlbum([[adam, maya], [maya], [river]]))
        const row = trackRow(page, 0)

        await row.getByRole('button', { name: 'Seek within Karasu' }).focus()
        await page.keyboard.press('Tab')
        const trackStack = row.getByRole('img', { name: 'Bought by Adam Pitts and Maya' })
        await expect(trackStack).toBeFocused()
        await expect(page.getByRole('tooltip')).toHaveText('Bought by Adam Pitts and Maya')

        await releaseStack(page).focus()
        await expect(page.getByRole('tooltip')).toHaveText('Adam Pitts, Maya, and River & Rain')
    })

    test('shows an initial when a fan has no photo or the photo fails to load', async ({ page }) => {
        await page.route('https://fans.example/broken.jpg', route => route.abort())
        const missing = createBandcampFan('River & Rain', { imageUrl: null })
        const broken = createBandcampFan('Theo Marsh', { imageUrl: 'https://fans.example/broken.jpg' })
        await openFeed(page, createPurchasedAlbum([[missing, broken, adam], [missing], [broken]]))

        const releaseAvatars = releaseStack(page).locator('[data-slot="avatar"]')
        await expect(releaseAvatars.nth(0)).toHaveText('R')
        await expect(releaseAvatars.nth(1)).toHaveText('T')
        await expect(releaseAvatars.nth(2).locator('img')).toBeVisible()
        await expect(trackRow(page, 1).locator('[data-slot="avatar"]')).toHaveText('R')
        await expect(trackRow(page, 2).locator('[data-slot="avatar"]')).toHaveText('T')
    })

    test('folds many buyers into a count and lists them all', async ({ page }) => {
        const names = ['Ada', 'Ben', 'Cyrus', 'Dee', 'Eve', 'Fay', 'Gus', 'Hal']
        const crowd = names.map(name => createBandcampFan(name))
        await openFeed(page, createPurchasedAlbum([crowd, crowd.slice(0, 4), crowd.slice(0, 3)]))

        await expect(releaseStack(page).locator('[data-slot="avatar"]')).toHaveCount(4)
        await expect(releaseStack(page).locator('[data-slot="avatar-group-count"]')).toHaveText('+4')
        await expect(trackRow(page, 0).locator('[data-slot="avatar-group-count"]')).toHaveText('+6')
        await expect(trackRow(page, 1).locator('[data-slot="avatar-group-count"]')).toHaveText('+2')
        await expect(trackRow(page, 2).locator('[data-slot="avatar"]')).toHaveCount(3)
        await expect(trackRow(page, 2).locator('[data-slot="avatar-group-count"]')).toHaveCount(0)

        await trackRow(page, 0).getByRole('img').focus()
        await expect(page.getByRole('tooltip')).toHaveText(
            'Bought by Ada, Ben, Cyrus, Dee, Eve, Fay, Gus, and Hal',
        )
    })

    test('truncates a long buyer name inside a narrow release column', async ({ page }) => {
        await page.setViewportSize({ width: 800, height: 700 })
        const longName = 'The Midnight Listening Club of Greater Manchester'
        await openFeed(page, createPurchasedAlbum([[createBandcampFan(longName)], [], []]))

        const summary = page.locator('.fan-summary')
        await expect(summary).toHaveText(`Bought by ${longName}`)
        const overflow = await summary.evaluate(element => {
            const column = element.closest('.text-column')
            if (!column) throw new Error('Text column is missing')
            return element.getBoundingClientRect().right - column.getBoundingClientRect().right
        })
        expect(overflow).toBeLessThanOrEqual(0)
        expect(await summary.evaluate(element => element.scrollWidth > element.clientWidth)).toBe(true)
    })

    test('credits buyers on a release that first arrived as a new-release notification', async ({ page }) => {
        await openFeed(
            page,
            createPurchasedAlbum([[maya], [], []], { sourceType: 'EMAIL.BANDCAMP_NEW_RELEASE' }),
        )

        await expect(page.locator('.fan-summary')).toHaveText('Bought by Maya')
        await expect(trackRow(page, 0).getByRole('img', { name: 'Bought by Maya' })).toBeVisible()
    })

    test('shows no fan stack on a release nobody bought', async ({ page }) => {
        await openFeed(page, createHydratedRelease())

        await expect(page.locator('.fan-avatar-stack')).toHaveCount(0)
    })

    test('keeps the buyers and release link when hydration fails', async ({ page }) => {
        const base = createHydratedRelease()
        const release = createHydratedRelease({
            sourceType: 'EMAIL.BANDCAMP_FANS_BOUGHT_MUSIC',
            error: { message: 'The Bandcamp track or album could not be found' },
            data: {
                ...base.data,
                fans: [adam],
                releaseName: base.data.releaseUrl,
                tracks: [],
                iframeUrl: null,
                imageUrl: undefined,
                band: null,
            },
        })
        await openFeed(page, release)

        await expect(page.locator('.fan-summary')).toHaveText('Bought by Adam Pitts')
        await expect(page.getByText('The Bandcamp track or album could not be found')).toBeVisible()
        await expect(page.getByRole('link', { name: release.data.releaseUrl, exact: true })).toHaveAttribute(
            'href',
            release.data.releaseUrl,
        )
    })
})
