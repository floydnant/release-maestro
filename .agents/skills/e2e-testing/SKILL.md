---
name: e2e-testing
description: Playwright E2E readiness and test authoring guidance.
---

# E2E Testing Guidelines:

- test user-visible behavior, not implementation details (no CSS/XPath-first selectors)
- keep tests isolated with `beforeEach`; each test must run independently
- prefer role/text locators, then `getByTestId` for explicit test contracts
- add minimal, stable `testId` hooks for critical flows (navigation CTAs, form controls)
- use web-first assertions (`await expect(locator).toBeVisible()`), avoid manual `isVisible()` checks
- keep specs focused on critical user journeys and route-level navigation
- use soft assertions only for known prototype gaps that should not block signal
- keep traces/screenshots on failure and use trace viewer for CI/local debugging
- when validating a manually running local server, run with `PLAYWRIGHT_BASE_URL=http://localhost:8081`
