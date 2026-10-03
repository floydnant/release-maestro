// Covers preview playback and seeking behavior for feed item tracks.
import { expect, type Page, test } from '@playwright/test'
import { installAudioFixtureRoute } from '../../fixtures/audio.fixture'
import { createHydratedRelease, createRendererScenario, scenarioBuilder } from '../scenario-harness'

const createFeedWithPlayableTrack = async (page: Page) => {
    const release = createHydratedRelease()

    await installAudioFixtureRoute(page)
    await createRendererScenario(page, scenarioBuilder().feed([release]).build())

    return release
}

const startKarasuPlayback = async (page: Page) => {
    await createFeedWithPlayableTrack(page)
    await page.getByRole('button', { name: 'Play Karasu' }).click()
    await expect(page.getByRole('button', { name: 'Pause Karasu' })).toBeVisible()
}

test.describe('release feed playback scenarios', () => {
    test('plays and seeks a real preview stream', async ({ page }) => {
        await createFeedWithPlayableTrack(page)
        await page.context().setOffline(true)

        await page.getByRole('button', { name: 'Play Karasu' }).click()
        await expect(page.getByRole('button', { name: 'Pause Karasu' })).toBeVisible()
        await expect(page.getByRole('button', { name: 'Seek within Karasu' })).toHaveCSS('font-weight', '400')

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
        await expect(progress).toHaveAttribute('aria-valuetext', /\d+:\d{2} of \d+:\d{2}/)
        await expect
            .poll(() =>
                progress.evaluate(meter => {
                    const indicator = meter.querySelector('[data-slot="progress-indicator"]')
                    if (!indicator) throw new Error('Playback progress indicator is missing')
                    const bounds = meter.getBoundingClientRect()
                    return (indicator.getBoundingClientRect().right - bounds.left) / bounds.width
                }),
            )
            .toBeGreaterThan(0.7)
    })

    test('keeps long track titles and seek controls inside the artwork column', async ({ page }) => {
        const title =
            'An exceptionally long track title that must truncate beside its duration and play control'
        const release = createHydratedRelease()
        const longRelease = {
            ...release,
            data: { ...release.data, tracks: release.data.tracks.map(track => ({ ...track, title })) },
        }
        await createRendererScenario(page, scenarioBuilder().feed([longRelease]).build())
        const seeker = page.getByRole('button', { name: `Seek within ${title}` })
        await expect(seeker).toBeVisible()
        const overflow = await seeker.evaluate(button => {
            const row = button.closest('[data-track-index]')
            if (!row) throw new Error('Track row is missing')
            return Math.max(
                row.scrollWidth - row.clientWidth,
                button.getBoundingClientRect().right - row.getBoundingClientRect().right,
            )
        })
        expect(overflow).toBeLessThanOrEqual(1)
    })

    test('toggles the current track from the sidebar playback control', async ({ page }) => {
        await startKarasuPlayback(page)

        await page.getByRole('button', { name: 'PAUSE', exact: true }).click()

        await expect(page.getByRole('button', { name: 'Play Karasu' })).toBeVisible()
        await expect(page.getByRole('button', { name: 'PLAY', exact: true })).toBeVisible()

        await page.getByRole('button', { name: 'PLAY', exact: true }).click()

        await expect(page.getByRole('button', { name: 'Pause Karasu' })).toBeVisible()
        await expect(page.getByRole('button', { name: 'PAUSE', exact: true })).toBeVisible()
    })

    test('toggles the current track with the spacebar shortcut', async ({ page }) => {
        await startKarasuPlayback(page)

        await page.keyboard.press('Space')

        await expect(page.getByRole('button', { name: 'Play Karasu' })).toBeVisible()

        await page.keyboard.press('Space')

        await expect(page.getByRole('button', { name: 'Pause Karasu' })).toBeVisible()
    })

    test('shows the track seeker focus ring only for keyboard focus', async ({ page }) => {
        await createFeedWithPlayableTrack(page)

        const seeker = page.getByRole('button', { name: 'Seek within Karasu' })

        await seeker.click()
        await page.keyboard.press('Space')

        await expect(seeker).not.toBeFocused()
        await expect
            .poll(async () => seeker.evaluate(element => element.matches(':focus-visible')))
            .toBe(false)

        await page.getByRole('button', { name: /^(Play|Pause) Karasu$/ }).focus()
        await page.keyboard.press('Tab')

        await expect(seeker).toBeFocused()
        await expect
            .poll(async () => seeker.evaluate(element => element.matches(':focus-visible')))
            .toBe(true)
    })
})
