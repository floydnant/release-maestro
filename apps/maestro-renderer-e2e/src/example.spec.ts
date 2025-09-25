import { test, expect } from '@playwright/test'

test('has title', async ({ page }) => {
    await page.goto('/')

    // Expect title to contain a substring.
    expect(await page.locator('title').innerText()).toContain('Release Maestro')
})
