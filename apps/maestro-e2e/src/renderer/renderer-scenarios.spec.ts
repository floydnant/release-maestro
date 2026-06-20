/* eslint-disable playwright/expect-expect, playwright/no-skipped-test */
import { test } from '@playwright/test'

// Intentionally skipped until the renderer scenario harness exists.
// See docs/testing.md for the intended fake Electron bridge shape.
test.describe.skip('renderer scenario E2E', () => {
    test('renders mocked UI scenarios without launching Electron', async () => {
        // Placeholder for a future mocked renderer harness.
    })
})
