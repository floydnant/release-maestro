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
    test('fills history buttons only while the pointer hovers them', async ({ page }) => {
        await createRendererScenario(page, scenarioBuilder().build(), '/home')
        await page.getByRole('link', { name: 'Settings', exact: true }).click()
        const back = page.getByRole('button', { name: 'Back', exact: true })
        await expect(back).toBeEnabled()
        await page.mouse.move(0, 0)
        await page.getByRole('link', { name: 'Home', exact: true }).press('Shift+Tab')
        await expect(back).toBeFocused()
        await expect.poll(() => back.evaluate(element => element.matches(':focus-visible'))).toBe(true)
        await expect(back).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)')
        await hoverAndSettle(back)
        await expect(back).not.toHaveCSS('background-color', 'rgba(0, 0, 0, 0)')
        await page.mouse.move(0, 0)
        await expect(back).toBeFocused()
        await expect(back).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)')
    })

    test('sizes regular buttons from their text and original padding', async ({ page }) => {
        await createRendererScenario(page, scenarioBuilder().build(), '/settings/design-system')
        const button = page.getByRole('button', { name: 'Preview folder import' })
        await expect(button).toBeVisible()
        await expect.poll(() => remPadding(button, 'paddingLeft')).toBeCloseTo(0.75, 3)
        await expect.poll(() => remPadding(button, 'paddingRight')).toBeCloseTo(0.75, 3)
        await expect.poll(() => remPadding(button, 'paddingTop')).toBeCloseTo(0.375, 3)
        await expect.poll(() => remPadding(button, 'paddingBottom')).toBeCloseTo(0.375, 3)
        await expect
            .poll(() =>
                button.evaluate(element => {
                    const style = getComputedStyle(element)
                    const contentHeight =
                        parseFloat(style.lineHeight) +
                        parseFloat(style.paddingTop) +
                        parseFloat(style.paddingBottom) +
                        parseFloat(style.borderTopWidth) +
                        parseFloat(style.borderBottomWidth)
                    return Math.abs(element.getBoundingClientRect().height - contentHeight)
                }),
            )
            .toBeLessThan(1)
    })

    test('keeps feed seek targets and snooze controls visually plain on hover', async ({ page }) => {
        await createRendererScenario(page, scenarioBuilder().feed([createHydratedRelease()]).build(), '/feed')
        const seeker = page.getByRole('button', { name: 'Seek within Karasu' })
        await hoverAndSettle(seeker)
        await expect(seeker).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)')
        await expect(seeker).toHaveCSS('padding-left', '0px')
        await expect.poll(() => remPadding(seeker, 'paddingTop')).toBeCloseTo(0.25, 3)
        const snooze = page.getByRole('button', { name: 'Snooze release', exact: true })
        await hoverAndSettle(snooze)
        await expect(snooze).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)')
        await expect.poll(() => remPadding(snooze, 'paddingLeft')).toBeCloseTo(0.5, 3)
        await expect.poll(() => remPadding(snooze, 'paddingTop')).toBeCloseTo(0.5, 3)
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
