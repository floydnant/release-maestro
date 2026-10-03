import { expect, test } from '@playwright/test'
import { createRendererScenario, scenarioBuilder } from '../scenario-harness'

test.describe('existing field appearance', () => {
    test('keeps the mailbox label, help and input at the original spacing', async ({ page }) => {
        await createRendererScenario(page, scenarioBuilder().build(), '/settings/apple-mail')
        const label = page.getByText('Mailbox Name', { exact: true })
        const description = page.getByText('The name of the mailbox to import from Apple Mail.', {
            exact: true,
        })
        const input = page.getByLabel('Mailbox Name')
        await expect(input).toBeVisible()
        await expect(input).toHaveAccessibleDescription('The name of the mailbox to import from Apple Mail.')

        await expect
            .poll(async () => {
                const [labelBox, descriptionBox, inputBox, rootFontSize] = await Promise.all([
                    label.boundingBox(),
                    description.boundingBox(),
                    input.boundingBox(),
                    page.locator('html').evaluate(element => parseFloat(getComputedStyle(element).fontSize)),
                ])
                if (!labelBox || !descriptionBox || !inputBox) return null
                return {
                    labelToHelp: (descriptionBox.y - labelBox.y - labelBox.height) / rootFontSize,
                    helpToInput: (inputBox.y - descriptionBox.y - descriptionBox.height) / rootFontSize,
                }
            })
            .toMatchObject({
                labelToHelp: expect.closeTo(0.25, 2),
                helpToInput: expect.closeTo(0.75, 2),
            })

        await expect(label).toHaveCSS('font-weight', '600')
        await expect
            .poll(() =>
                input.evaluate(element => {
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

    test('keeps native textareas bounded while editing long content', async ({ page }) => {
        await createRendererScenario(page, scenarioBuilder().build(), '/settings/debug')
        const payload = page.getByLabel('Write tag payload')
        await expect(payload).toBeVisible()
        await expect(payload).toHaveAccessibleDescription(
            'Writes go through the Rust engine tri-state update contract. Use this only on disposable files.',
        )
        const originalHeight = await payload.evaluate(element => element.getBoundingClientRect().height)

        await payload.fill(
            JSON.stringify({ title: Array.from({ length: 40 }, (_, index) => `Track ${index}`) }, null, 2),
        )

        await expect
            .poll(() => payload.evaluate(element => element.getBoundingClientRect().height))
            .toBeCloseTo(originalHeight, 1)
        await expect
            .poll(() => payload.evaluate(element => element.scrollHeight - element.clientHeight))
            .toBeGreaterThan(0)
        await expect(page.getByRole('button', { name: 'Write Tags', exact: true })).toBeVisible()
    })
})
