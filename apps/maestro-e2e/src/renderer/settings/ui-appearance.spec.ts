import { expect, test, type Locator } from '@playwright/test'
import {
    createHydratedRelease,
    createRendererScenario,
    rendererScenarios,
    scenarioBuilder,
} from '../scenario-harness'

const hoverAndSettle = async (control: Locator) => {
    await control.hover()
    await control.evaluate(async element => {
        void getComputedStyle(element).backgroundColor
        await Promise.all(element.getAnimations().map(animation => animation.finished))
    })
}

const remPadding = (
    control: Locator,
    side: 'paddingLeft' | 'paddingRight' | 'paddingTop' | 'paddingBottom',
) =>
    control.evaluate(
        (element, property) =>
            parseFloat(getComputedStyle(element)[property]) /
            parseFloat(getComputedStyle(document.documentElement).fontSize),
        side,
    )

test.describe('existing control appearance', () => {
    test('keeps the arrow cursor on styled links and disclosures', async ({ page }) => {
        await createRendererScenario(page, scenarioBuilder().build(), '/settings/debug')
        const navigationLink = page.getByRole('link', { name: 'Settings', exact: true })
        await navigationLink.hover()
        await expect(navigationLink).toHaveCSS('cursor', 'default')
        const disclosure = page.locator('summary', { hasText: 'Health payload' })
        await expect(disclosure).toHaveCSS('cursor', 'default')
    })

    test('history buttons share the quiet control states and stay unfilled while disabled', async ({
        page,
    }) => {
        await createRendererScenario(page, scenarioBuilder().build(), '/home')
        const forward = page.getByRole('button', { name: 'Forward', exact: true })
        await expect(forward).toBeDisabled()
        await expect(forward).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)')

        await page.getByRole('link', { name: 'Settings', exact: true }).click()
        const back = page.getByRole('button', { name: 'Back', exact: true })
        await expect(back).toBeEnabled()
        await page.mouse.move(0, 0)
        await expect(back).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)')
        await hoverAndSettle(back)
        const hovered = await back.evaluate(element => getComputedStyle(element).backgroundColor)
        expect(hovered).not.toBe('rgba(0, 0, 0, 0)')
        await page.mouse.move(0, 0)
        await page.getByRole('link', { name: 'Home', exact: true }).press('Shift+Tab')
        await expect(back).toBeFocused()
        await expect(back).toHaveCSS('background-color', hovered)
    })

    test('gives every single-line control one height, whatever its border or type', async ({ page }) => {
        await createRendererScenario(page, scenarioBuilder().build(), '/settings/design-system')
        const primary = page.getByRole('button', { name: 'Preview folder import' })
        const controls = [
            primary,
            page.getByRole('button', { name: 'Outline action' }),
            page.getByRole('button', { name: 'Danger action' }),
            page.getByRole('textbox', { name: 'Search releases' }),
            page.getByRole('combobox', { name: 'Library view' }),
        ]
        await expect(primary).toBeVisible()
        const controlHeight = await page.evaluate(() => {
            const probe = document.createElement('div')
            probe.style.height = 'var(--foundation-size-control-sm)'
            document.body.append(probe)
            const height = probe.getBoundingClientRect().height
            probe.remove()
            return height
        })
        for (const control of controls) {
            await expect
                .poll(() => control.evaluate(element => element.getBoundingClientRect().height))
                .toBeCloseTo(controlHeight, 1)
        }
    })

    test('keeps feed seek targets plain and gives snooze the quiet icon-button states', async ({ page }) => {
        await createRendererScenario(page, scenarioBuilder().feed([createHydratedRelease()]).build(), '/feed')
        const seeker = page.getByRole('button', { name: 'Seek within Karasu' })
        await hoverAndSettle(seeker)
        await expect(seeker).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)')
        await expect(seeker).toHaveCSS('padding-left', '0px')
        await expect.poll(() => remPadding(seeker, 'paddingTop')).toBeCloseTo(0.25, 3)
        const snooze = page.getByRole('button', { name: 'Snooze release', exact: true })
        await page.mouse.move(0, 0)
        await expect(snooze).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)')
        await hoverAndSettle(snooze)
        await expect(snooze).not.toHaveCSS('background-color', 'rgba(0, 0, 0, 0)')
        await expect
            .poll(() =>
                snooze.evaluate(
                    element =>
                        element.getBoundingClientRect().width /
                        parseFloat(getComputedStyle(document.documentElement).fontSize),
                ),
            )
            .toBeCloseTo(2.25, 2)
    })

    test('keeps sortable track headings plain and at their original height', async ({ page }) => {
        await createRendererScenario(page, rendererScenarios.tracks.withSongs(), '/tracks')
        const sort = page.getByRole('button', { name: 'Sort by Title', exact: true })
        await hoverAndSettle(sort)
        await expect(sort).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)')
        await expect.poll(() => remPadding(sort, 'paddingLeft')).toBeCloseTo(0.5, 3)
        await expect.poll(() => remPadding(sort, 'paddingTop')).toBeCloseTo(0.5, 3)
        await expect
            .poll(() =>
                sort.evaluate(element => {
                    const header = element.closest('[role="columnheader"]')
                    if (!header) return Infinity
                    const style = getComputedStyle(element)
                    return Math.abs(
                        header.getBoundingClientRect().height -
                            parseFloat(style.lineHeight) -
                            parseFloat(style.paddingTop) -
                            parseFloat(style.paddingBottom) -
                            parseFloat(getComputedStyle(header).borderBottomWidth),
                    )
                }),
            )
            .toBeLessThan(1)
    })
})
