// Covers the release timestamp line: the release day with its distance from today, then when the
// email arrived, the same for every kind of Bandcamp email.
import { expect, type Locator, type Page, test } from '@playwright/test'
import { calendarDaySchema, HydratedFeedItem } from '@release-maestro/core'
import { createHydratedRelease, createRendererScenario, scenarioBuilder } from '../scenario-harness'

test.use({ timezoneId: 'Europe/Berlin' })

/** Noon on Oct 23 2026 in Berlin. */
const now = new Date('2026-10-23T10:00:00Z')

const releaseWith = (
    releaseDate: string | null,
    emailReceivedAt: Date,
    overrides: Partial<HydratedFeedItem> = {},
): HydratedFeedItem => {
    const base = createHydratedRelease()
    return createHydratedRelease({
        ...overrides,
        data: {
            ...base.data,
            releaseDate: releaseDate === null ? null : calendarDaySchema.parse(releaseDate),
            emailReceivedAt,
        },
    })
}

const openFeed = async (page: Page, release: HydratedFeedItem) => {
    await page.clock.setFixedTime(now)
    await createRendererScenario(page, scenarioBuilder().feed([release]).build())
    await expect(page.getByRole('link', { name: release.data.releaseName })).toBeVisible()
}

/** A timestamp, found by the full date it speaks. */
const timestamp = (page: Page, spoken: string) => page.getByRole('time').filter({ hasText: spoken })

/** The paragraph that holds the release's timestamps. */
const timestampLine = (page: Page) => page.locator('.text-column p').filter({ has: page.getByRole('time') })

/** The line as it reads on screen, without the full dates only assistive technology hears. */
const visibleText = (line: Locator) =>
    line.evaluate(element => {
        const visible = element.cloneNode(true)
        if (!(visible instanceof HTMLElement)) throw new Error('The timestamp line is not an element')
        visible.querySelectorAll('.sr-only').forEach(spoken => spoken.remove())
        return (visible.textContent ?? '').replace(/\s+/g, ' ').trim()
    })

test.describe('release feed timestamps', () => {
    for (const [releaseDate, emailReceivedAt, expected, releaseSpoken, emailSpoken] of [
        [
            '2026-10-07',
            '2026-10-03T08:00:00Z',
            'by Shiva Chandra • released Oct 7 (16d ago) • 20d ago',
            'Release date: October 7, 2026',
            'Email received: October 3, 2026, 10:00 AM',
        ],
        [
            '2026-10-30',
            '2026-10-21T08:00:00Z',
            'by Shiva Chandra • releases Oct 30 (in 7d) • 2d ago',
            'Release date: October 30, 2026',
            'Email received: October 21, 2026, 10:00 AM',
        ],
        [
            '2025-03-05',
            '2026-10-03T08:00:00Z',
            'by Shiva Chandra • released Mar 5 2025 (1y ago) • 20d ago',
            'Release date: March 5, 2025',
            'Email received: October 3, 2026, 10:00 AM',
        ],
    ] as const) {
        test(`reads ${expected}`, async ({ page }) => {
            await openFeed(page, releaseWith(releaseDate, new Date(emailReceivedAt)))

            expect(await visibleText(timestampLine(page))).toBe(expected)
            // Each timestamp speaks its full date, with the year and the time the email arrived, in
            // place of the short form; the mail icon is decoration.
            await expect(timestamp(page, releaseSpoken)).toMatchAriaSnapshot(`- time: "${releaseSpoken}"`)
            const emailReceived = timestamp(page, emailSpoken)
            await expect(emailReceived).toMatchAriaSnapshot(`- time: "${emailSpoken}"`)
            const iconGap = await emailReceived.evaluate(element => {
                const separator = element.previousElementSibling
                const icon = element.querySelector('app-icon')
                if (!separator || !icon)
                    throw new Error('The email timestamp is missing its separator or icon')
                return icon.getBoundingClientRect().left - separator.getBoundingClientRect().right
            })
            expect(iconGap).toBeGreaterThan(0)
            await expect(emailReceived.locator('app-icon[aria-hidden="true"]')).toBeVisible()
        })
    }

    test('labels a fan purchase email exactly like a new release email', async ({ page }) => {
        await openFeed(
            page,
            releaseWith('2026-10-07', new Date('2026-10-03T08:00:00Z'), {
                sourceType: 'EMAIL.BANDCAMP_FANS_BOUGHT_MUSIC',
            }),
        )

        expect(await visibleText(timestampLine(page))).toBe(
            'by Shiva Chandra • released Oct 7 (16d ago) • 20d ago',
        )
    })

    test('shows only when the email arrived for a release without a known date', async ({ page }) => {
        await openFeed(page, releaseWith(null, new Date('2026-10-23T06:00:00Z')))

        expect(await visibleText(timestampLine(page))).toBe('by Shiva Chandra • today')
        await expect(timestampLine(page).getByRole('time')).toHaveCount(1)
        await expect(timestampLine(page).getByRole('time')).toMatchAriaSnapshot(
            '- time: "Email received: October 23, 2026, 8:00 AM"',
        )
    })

    test('wraps the timestamp line inside a narrow window instead of clipping it', async ({ page }) => {
        await page.setViewportSize({ width: 800, height: 700 })
        await openFeed(page, releaseWith('2025-03-05', new Date('2026-10-03T08:00:00Z')))

        const line = timestampLine(page)
        const columnRight = await page
            .locator('.text-column')
            .evaluate(column => column.getBoundingClientRect().right)
        const partRights = await line
            .locator('.artist, time')
            .evaluateAll(parts => parts.map(part => part.getBoundingClientRect().right))
        expect(partRights).toHaveLength(3)
        for (const right of partRights) expect(right).toBeLessThanOrEqual(columnRight + 0.5)
        expect(await line.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true)
    })

    test('keeps the exact dates on the timestamps', async ({ page }) => {
        await openFeed(page, releaseWith('2026-10-07', new Date('2026-10-03T08:00:00Z')))

        const releaseDate = timestamp(page, 'Release date: October 7, 2026')
        const emailReceived = timestamp(page, 'Email received: October 3, 2026, 10:00 AM')
        await expect(releaseDate).toHaveAttribute('datetime', '2026-10-07')
        await expect(emailReceived).toHaveAttribute('datetime', '2026-10-03T08:00:00.000Z')

        await releaseDate.hover()
        await expect(page.getByRole('tooltip')).toHaveText('Release date: October 7, 2026')
        await emailReceived.hover()
        await expect(page.getByRole('tooltip')).toHaveText('Email received: October 3, 2026, 10:00 AM')
    })
})
