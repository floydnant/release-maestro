---
name: e2e-testing
description: Playwright E2E readiness and test authoring guidance.
---

# E2E Testing Guidelines:

- read `docs/testing.md` first — it owns the layer split (renderer vs full Electron), the locator
  ladder, fixture isolation, and when each layer is the right one. This file is generic advice on top
  of it; where the two differ, `docs/testing.md` wins
- test user-visible behavior, not implementation details (no CSS/XPath-first selectors, no tailwind
  class selectors)
- follow the locator ladder in `docs/testing.md`: role and accessible name, then label, then visible
  text, and `data-testid` only as the documented last resort. If a nav CTA or form control needs a
  testid to be reachable, that is an accessibility bug in the component — fix the component
- keep tests isolated with `beforeEach`; each test must run independently
- use web-first assertions (`await expect(locator).toBeVisible()`), avoid manual `isVisible()` checks
- keep specs focused on critical user journeys and route-level navigation
- use soft assertions only for known prototype gaps that should not block signal
- use trace viewer for CI/local debugging. Electron contexts are traced explicitly by
  `launch-release-maestro.ts`. The visible, unfocused window also remains available for ad hoc
  screenshots when the user wants an on-demand visual; keep those one-off captures out of committed
  behavioral specs
- iterate on one spec or test title when useful, then widen to the relevant suite before handoff;
  use the target-specific commands in `docs/testing.md#fast-iteration`
- all suites type-check before they run (`maestro-e2e:e2e`, `:e2e-production`, and `:e2e-renderer`
  depend on `maestro-e2e:typecheck`), because Playwright transpiles without semantic checking
- to point the renderer suite at an already-running dev server, set `BASE_URL`; it defaults to
  `http://localhost:4200`
