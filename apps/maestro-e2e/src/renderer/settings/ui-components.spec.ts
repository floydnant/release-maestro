import { expect, test } from '@playwright/test'
import { createRendererScenario, scenarioBuilder } from '../scenario-harness'

test.describe('shared UI components', () => {
    test.beforeEach(async ({ page }) => {
        await createRendererScenario(page, scenarioBuilder().build(), '/settings/design-system')
        await expect(page.getByRole('region', { name: 'Components', exact: true })).toHaveCount(1)
        await expect(page.getByRole('heading', { name: 'Components', exact: true })).toBeVisible()
    })

    test('opens a dialog with the keyboard, traps focus and restores its trigger on Escape', async ({
        page,
    }) => {
        const trigger = page.getByRole('button', { name: 'Preview folder import' })
        await trigger.press('Enter')

        const dialog = page.getByRole('dialog', { name: 'Folder import preview' })
        await expect(dialog).toBeVisible()
        await expect(dialog).toHaveAccessibleDescription('Choose a label for this library folder.')

        const label = dialog.getByLabel('Folder label')
        const save = dialog.getByRole('button', { name: 'Save label', exact: true })
        const close = dialog.getByRole('button', { name: 'Close', exact: true })
        await save.focus()
        await save.press('Tab')
        await expect(close).toBeFocused()
        await close.press('Tab')
        await expect(label).toBeFocused()
        await label.press('Shift+Tab')
        await expect(close).toBeFocused()

        await close.press('Escape')
        await expect(dialog).toBeHidden()
        await expect(trigger).toBeFocused()
    })

    test('saves through the dialog and returns focus to the launching action', async ({ page }) => {
        const trigger = page.getByRole('button', { name: 'Preview folder import' })
        await trigger.click()

        const dialog = page.getByRole('dialog', { name: 'Folder import preview' })
        await dialog.getByLabel('Folder label').fill('Recent purchases')
        await dialog.getByRole('button', { name: 'Save label' }).click()

        await expect(dialog).toBeHidden()
        await expect(
            page.getByRole('status').filter({ hasText: 'Folder label saved: Recent purchases' }),
        ).toBeVisible()
        await expect(trigger).toBeFocused()
    })

    test('highlights the keyboard option, commits selection and dismisses without changing it', async ({
        page,
    }) => {
        const trigger = page.getByRole('combobox', { name: 'Library view' })
        await expect(trigger).toHaveText('Tracks')
        await trigger.press('Enter')

        const options = page.getByRole('listbox')
        await expect(options).toBeVisible()
        const tracks = options.getByRole('option', { name: 'Tracks', exact: true })
        const albums = options.getByRole('option', { name: 'Albums', exact: true })
        await expect(tracks).toHaveAttribute('aria-selected', 'true')
        await expect(trigger).toHaveAttribute('aria-expanded', 'true')
        await expect(trigger).toHaveAttribute(
            'aria-activedescendant',
            await tracks.evaluate(option => option.id),
        )
        await trigger.press('ArrowDown')

        const highlightColor = await page.evaluate(() => {
            const reference = document.createElement('span')
            reference.style.backgroundColor = 'var(--color-action-quiet-hover)'
            document.body.append(reference)
            const color = getComputedStyle(reference).backgroundColor
            reference.remove()
            return color
        })
        await expect(albums).toHaveCSS('background-color', highlightColor)
        await expect(tracks).not.toHaveCSS('background-color', highlightColor)
        await expect(trigger).toHaveAttribute('aria-activedescendant', /.+/)
        await expect(trigger).toHaveAttribute(
            'aria-activedescendant',
            await albums.evaluate(option => option.id),
        )
        await expect(albums).toHaveAttribute('aria-selected', 'false')

        await trigger.press('Enter')
        await expect(options).toBeHidden()
        await expect(trigger).toHaveText('Albums')
        await expect(trigger).toBeFocused()

        await trigger.press('Enter')
        await expect(options).toBeVisible()
        await expect(trigger).toHaveAttribute('aria-expanded', 'true')
        await expect(trigger).toHaveAttribute(
            'aria-activedescendant',
            await albums.evaluate(option => option.id),
        )
        await trigger.press('ArrowDown')
        const artists = options.getByRole('option', { name: 'Artists', exact: true })
        await expect(artists).toHaveCSS('background-color', highlightColor)
        await expect(trigger).toHaveAttribute(
            'aria-activedescendant',
            await artists.evaluate(option => option.id),
        )
        await expect(artists).toHaveAttribute('aria-selected', 'false')
        await trigger.press('Escape')
        await expect(options).toBeHidden()
        await expect(trigger).toHaveText('Albums')
        await expect(trigger).toBeFocused()
    })

    test('opens a nested menu with the keyboard and restores focus as each level closes', async ({
        page,
    }) => {
        const trigger = page.getByRole('button', { name: 'Preview library actions' })
        await trigger.press('ArrowDown')

        const actions = page.getByRole('menu', { name: 'Library actions', exact: true })
        await expect(actions).toBeVisible()
        const scanOptions = actions.getByRole('menuitem', { name: 'Scan options', exact: true })
        await expect(scanOptions).toBeFocused()
        await scanOptions.press('ArrowRight')

        const submenu = page.getByRole('menu', { name: 'Scan options', exact: true })
        await expect(submenu).toBeVisible()
        const scan = submenu.getByRole('menuitem', { name: 'Scan configured folders' })
        await expect(scan).toBeFocused()
        await scan.press('Escape')
        await expect(submenu).toBeHidden()
        await expect(scanOptions).toBeFocused()
        await scanOptions.press('Escape')
        await expect(actions).toBeHidden()
        await expect(trigger).toBeFocused()

        await trigger.press('ArrowDown')
        await scanOptions.press('ArrowRight')
        await expect(scan).toBeFocused()
        await scan.press('Enter')
        await expect(submenu).toBeHidden()
        await expect(actions).toBeHidden()
        await expect(
            page.getByRole('status').filter({ hasText: 'Action selected: Scan configured folders' }),
        ).toBeVisible()
        await expect(trigger).toBeFocused()
    })

    test('shows a tooltip on keyboard focus and preserves native form controls', async ({ page }) => {
        const tooltipTrigger = page.getByRole('button', { name: 'About library scans' })
        await tooltipTrigger.focus()
        await expect(page.getByRole('tooltip')).toHaveText(
            'The library stays available while folders are scanned.',
        )

        const search = page.getByRole('textbox', { name: 'Search releases' })
        await search.fill('Bandcamp')
        await expect(search).toHaveValue('Bandcamp')
        await expect(page.getByRole('tooltip')).toBeHidden()

        const order = page.getByLabel('Library order')
        await expect(order).toHaveAttribute('id', 'shared-library-order')
        await expect(order).toHaveValue('dateAdded')
        await order.selectOption('year')
        await expect(order).toHaveValue('year')
        await expect(page.getByLabel('Unavailable filter')).toBeDisabled()
        await expect(page.getByRole('button', { name: 'Unavailable action' })).toBeDisabled()
        await expect(page.getByRole('progressbar', { name: 'Scanning library folders' })).toHaveAttribute(
            'aria-valuenow',
            '65',
        )
    })

    test('retains the two-arc loading spinner and the design system motion', async ({ page }) => {
        const spinner = page.getByRole('status', { name: 'Reading metadata' })
        await expect(spinner).toBeVisible()
        await expect(spinner).toHaveCSS('width', '22px')
        await expect(spinner).toHaveCSS('height', '22px')

        const circles = spinner.locator('circle')
        await expect(circles).toHaveCount(3)
        await expect(circles.nth(0)).toHaveCSS('animation-name', 'none')
        const firstArc = circles.nth(1)
        const secondArc = circles.nth(2)
        for (const arc of [firstArc, secondArc]) {
            await expect(arc).toHaveCSS('animation-duration', '0.8s')
            await expect(arc).toHaveCSS('animation-timing-function', 'linear')
            await expect(arc).toHaveCSS('animation-iteration-count', 'infinite')
            await expect(arc).toHaveCSS('stroke-linecap', 'round')
        }
        expect(await firstArc.evaluate(arc => getComputedStyle(arc).getPropertyValue('--rotation'))).toBe(
            '-90deg',
        )
        expect(await secondArc.evaluate(arc => getComputedStyle(arc).getPropertyValue('--rotation'))).toBe(
            '-270deg',
        )

        await page.emulateMedia({ reducedMotion: 'reduce' })
        await expect(firstArc).toHaveCSS('animation-duration', '0.001s')
        await expect(firstArc).toHaveCSS('animation-iteration-count', '1')
        await page.emulateMedia({ reducedMotion: 'no-preference' })
    })
})
