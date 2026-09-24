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
- treat an action as the start of a state change, not proof that it finished. After clicks, keys,
  scrolls, navigation, IPC responses, and resizes, wait for the outcome with a locator assertion or
  `expect.poll`; never add a sleep to make the race less likely
- when virtualization or rerendering can replace an element, send input through its locator instead
  of separating `focus()` from a later page-level keyboard call
- assert logical position in virtualized views: the expected item is visible and the expected data
  window was requested. Only assert exact pixels when pixels are the product contract
- keep the suites in the default `no-preference` motion mode. Do not use reduced motion, retries, or
  a larger timeout as a timing fix. Opt into reduced motion in a test only when that accessibility
  mode is the behavior under test
- keep specs focused on critical user journeys and route-level navigation
- use soft assertions only for known prototype gaps that should not block signal
- to inspect the running `make dev` app, use `inspect-running-app`; for CPU, traces, or memory,
  use `profiling`
- use trace viewer for CI/local debugging. Electron contexts are traced explicitly by
  `launch-release-maestro.ts`. The visible, unfocused window stays available for ad hoc
  screenshots when the user wants an on-demand visual; keep those one-off captures out of committed
  behavioral specs
- iterate on one spec or test title when useful, then widen to the relevant suite before handoff;
  use the target-specific commands in `docs/testing.md#fast-iteration`; for a suspected race, repeat
  the smallest slice with `--repeat-each` and `--retries=0`
- all suites type-check before they run (`maestro-e2e:e2e`, `:e2e-production`, and `:e2e-renderer`
  depend on `maestro-e2e:typecheck`), because Playwright transpiles without semantic checking
- to point the renderer suite at an already-running server, set `BASE_URL`; otherwise the instance
  manager assigns a transient renderer port. Electron E2E uses a separate transient allocation, so
  both targets can run concurrently
