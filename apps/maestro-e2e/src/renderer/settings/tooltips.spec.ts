import { expect, Locator, Page, test } from '@playwright/test'
import { createRendererScenario, scenarioBuilder } from '../scenario-harness'

const freezeTooltipClock = async (page: Page) => {
    await page.clock.install({ time: new Date('2026-10-03T00:00:00Z') })
    await page.clock.pauseAt(new Date('2026-10-03T00:00:01Z'))
}

const scrollTriggerPanel = async (trigger: Locator) => {
    expect(
        await trigger.evaluate(async element => {
            let panel = element.parentElement
            while (panel && panel.scrollHeight <= panel.clientHeight) panel = panel.parentElement
            if (!panel) return false
            const scrollPanel = panel
            const before = scrollPanel.scrollTop
            return await new Promise<boolean>(resolve => {
                const onScroll = () => resolve(scrollPanel.scrollTop > before)
                scrollPanel.addEventListener('scroll', onScroll, { once: true })
                scrollPanel.scrollBy(0, 100)
                if (scrollPanel.scrollTop === before) {
                    scrollPanel.removeEventListener('scroll', onScroll)
                    resolve(false)
                }
            })
        }),
    ).toBe(true)
}

test.describe('shared tooltips', () => {
    test.beforeEach(async ({ page }) => {
        await createRendererScenario(page, scenarioBuilder().build(), '/settings/design-system')
        await expect(page.getByRole('heading', { name: 'Shared UI components' })).toBeVisible()
    })

    test('waits 600 milliseconds before showing a hovered tooltip', async ({ page }) => {
        await freezeTooltipClock(page)
        const trigger = page.getByRole('button', { name: 'About library scans' })
        await trigger.hover()
        await page.clock.runFor(599)
        await expect(page.getByRole('tooltip')).toBeHidden()
        await page.clock.runFor(1)
        await expect(page.getByRole('tooltip')).toHaveText(
            'The library stays available while folders are scanned.',
        )
    })

    test('does not leave a tooltip stuck on a button clicked with the mouse', async ({ page }) => {
        const trigger = page.getByRole('button', { name: 'About library scans' })
        await trigger.hover()
        await expect(page.getByRole('tooltip')).toBeVisible()
        await trigger.click()
        await page.getByRole('heading', { name: 'Shared UI components' }).hover()
        await expect(page.getByRole('tooltip')).toBeHidden()
        await expect(trigger).toBeFocused()
    })

    test('keeps long paths inside a readable, viewport-bounded tooltip', async ({ page }) => {
        const trigger = page.getByRole('button', { name: 'Library path details' })
        await trigger.focus()
        const tooltip = page.getByRole('tooltip')
        await expect(tooltip).toBeVisible()
        for (const width of [1280, 960]) {
            await page.setViewportSize({ width, height: 900 })
            await page.getByRole('textbox', { name: 'Search releases' }).focus()
            await expect(tooltip).toBeHidden()
            await trigger.focus()
            await expect(tooltip).toBeVisible()
            await expect
                .poll(() =>
                    tooltip.evaluate(element => {
                        const rect = element.getBoundingClientRect()
                        return {
                            bounded:
                                rect.width <= Math.min(384, innerWidth - 16) &&
                                rect.left >= 0 &&
                                rect.right <= innerWidth,
                            wraps: element.scrollWidth <= element.clientWidth,
                        }
                    }),
                )
                .toEqual({ bounded: true, wraps: true })
        }
    })

    test('dismisses when a scrollable panel moves its trigger', async ({ page }) => {
        const trigger = page.getByRole('button', { name: 'About library scans' })
        await trigger.focus()
        await expect(page.getByRole('tooltip')).toBeVisible()
        await scrollTriggerPanel(trigger)
        await expect(page.getByRole('tooltip')).toBeHidden()
    })

    test('dismisses a hovered tooltip when the panel scrolls and permits another tooltip', async ({
        page,
    }) => {
        const trigger = page.getByRole('button', { name: 'About library scans' })
        await trigger.focus()
        const tooltip = page.getByRole('tooltip')
        await expect(tooltip).toBeVisible()
        await tooltip.hover()
        await scrollTriggerPanel(trigger)
        await expect(tooltip).toBeHidden()
        await page.getByRole('button', { name: 'Library path details' }).focus()
        await expect(tooltip).toContainText('/Users/floyd/Music/Bandcamp/')
        await expect(tooltip).toHaveCount(1)
    })

    test('cancels a pending tooltip when its panel scrolls', async ({ page }) => {
        await freezeTooltipClock(page)
        const trigger = page.getByRole('button', { name: 'About library scans' })
        await trigger.focus()
        await page.clock.runFor(300)
        await scrollTriggerPanel(trigger)
        await page.clock.runFor(600)
        await expect(page.getByRole('tooltip')).toBeHidden()
    })

    test('cancels pending hover when the pointer leaves and dismisses on navigation', async ({ page }) => {
        await freezeTooltipClock(page)
        const trigger = page.getByRole('button', { name: 'About library scans' })
        await trigger.hover()
        await page.clock.runFor(300)
        await page.getByRole('heading', { name: 'Shared UI components' }).hover()
        await page.clock.runFor(600)
        await expect(page.getByRole('tooltip')).toBeHidden()

        await trigger.focus()
        await page.clock.runFor(600)
        await expect(page.getByRole('tooltip')).toBeVisible()
        await page.getByRole('link', { name: 'Home', exact: true }).click()
        await expect(page.getByRole('tooltip')).toBeHidden()
    })

    test('dismisses with Escape while content is hovered and opens again on re-entry', async ({ page }) => {
        const trigger = page.getByRole('button', { name: 'About library scans' })
        await trigger.hover()
        const tooltip = page.getByRole('tooltip')
        await expect(tooltip).toBeVisible()
        await tooltip.hover()
        await page.keyboard.press('Escape')
        await expect(tooltip).toBeHidden()
        await page.getByRole('heading', { name: 'Shared UI components' }).hover()
        await trigger.hover()
        await expect(tooltip).toHaveText('The library stays available while folders are scanned.')
    })
})
