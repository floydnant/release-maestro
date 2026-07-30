# Testing Guide

Release Maestro uses Makefile targets as the public verification interface. Use `make ...`
commands locally and in CI; the Makefile delegates to Nx, Jest, Playwright, and project-specific
tooling.

Agent-facing repo instructions live in `AGENTS.md` and `docs/agents/`. Those docs point here for
testing conventions; update this guide when test strategy changes.

## Test Layers

- Unit tests cover renderer components, Electron backend services, core schemas, and metadata-engine
  behavior close to the code under test.
- Renderer E2E tests use a mocked renderer harness: browser-only scenarios that intentionally fake
  Electron IPC/backend responses to exercise complex UI states.
- Electron E2E tests launch the full Electron app with Playwright and verify renderer, IPC, Electron
  services, SQLite, and the metadata-engine worker together.

Both E2E layers live in `apps/maestro-e2e/`.

Use renderer E2E only when a mocked scenario is the point of the test: feed empty/error/loading states,
settings dirty/save states, import progress streams, scan progress streams, metadata failures, and other
UI state matrices that would be slow or awkward to arrange through the real app. Do not use renderer E2E
for generic routing smoke tests or happy paths that are better covered by full Electron E2E.

Renderer E2E uses the scenario harness in `apps/maestro-e2e/src/renderer/scenario-harness.ts`.
It installs a fake Electron bridge before Angular bootstraps:

- `window.process.type = 'renderer'`, so the real renderer services take their Electron code paths.
- `window.require('electron').ipcRenderer`, with mocked `invoke`, `send`, `on`, `off`, and `once`.
- A browser-side scenario backend that tests can inspect and mutate through Playwright helpers.

Do not mock Node modules such as `fs` or `child_process` in renderer E2E. Renderer code should go
through typed IPC for backend behavior; full Electron E2E covers the real Electron/Node integration.
See `apps/maestro-e2e/src/renderer/README.md` for harness authoring examples.

The harness's default scenario reports a **configured library folder**. Without it the library
onboarding route guard redirects every scenario navigation to `/import`, and unrelated tests fail for
reasons that have nothing to do with what they assert. A test that wants the onboarding state must opt
into it explicitly by overriding `get-settings`.

## Commands

Repo-wide, through `make`:

```bash
make test
make e2e
make e2e-renderer
make lint
make format-check
make sure          # format, lint, build, unit test, renderer E2E
make affected      # build, lint, unit/E2E tests for affected projects; no formatting
```

`make sure` mutates formatting. Full Electron E2E (`make e2e`) is intentionally separate because it
repeatedly opens and closes the desktop app; run it when the changed user journey needs the real
Electron, IPC, filesystem, database, or sidecar integration. `make affected` includes it when the
affected-project graph selects the E2E project.

One project at a time, straight to nx:

```bash
npx nx test maestro-renderer
npx nx test maestro-electron
npx nx test maestro-core
npx nx test metadata-engine
npx nx run maestro-renderer:design-tokens-check
```

Run the narrowest relevant command first. If a change crosses project boundaries, add the affected
project checks after the narrow check passes.

### Type checking

Playwright transpiles tests but does not perform semantic TypeScript checking, so `maestro-e2e`
declares a `typecheck` target running `tsc --noEmit` over both Electron and renderer E2E sources.
Both e2e targets `dependsOn` it, so it runs automatically before Playwright — in CI too. Run it
alone with `make typecheck-e2e` when you want the check without the suite.

No other project declares a typecheck target, so **`build` is the type gate for app code**: type
errors in renderer, electron, and core surface through `npx nx build <project>`, `make build`, or
`make sure`. Don't assume a green test run has checked types.

## E2E Conventions

Prefer user-visible locators:

1. Role and accessible name, such as `getByRole('button', { name: 'Start Scan' })`.
2. Labels, such as `getByLabel('Library scan paths')`.
3. Visible text when that text is the user contract.
4. `data-testid` only for intentionally non-user-facing hooks, highly repeated anonymous values, or
   volatile debug output that cannot be made accessible cleanly.

Electron E2E tests should isolate both filesystem inputs and app state:

- Copy committed fixture media into a fresh temp library before each test.
- Launch Electron with a fresh `RELEASE_MAESTRO_APP_DATA_DIR` so SQLite, cache, config, logs, and temp
  files cannot leak between tests.
- Use disposable copied files for write probes; never write tags to the source fixtures.
- Keep full-app tests broad but few. Prefer one high-value happy path over many brittle debug-harness
  assertions.

## Fixtures

Reusable test fixtures live in `fixtures/`. Tests may copy from that directory, but should not mutate
source fixture files. Keep large media fixtures intentional because they affect checkout and CI time.

Library scan E2E generates distinctly tagged media from the small committed fixture instead of
committing many near-identical binaries. Prefer extending
`apps/maestro-e2e/src/fixtures/tagged-library.fixture.ts` over adding binary fixtures; its local
comments and dependent assertions document the load-bearing dataset shape and cover-art dedup setup.
