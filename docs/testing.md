# Testing Guide

Release Maestro uses Makefile targets as the public verification interface. Use `make ...`
commands locally and in CI; the Makefile delegates to Nx, Jest, Playwright, and project-specific
tooling.

Agent-facing repo instructions live in `AGENTS.md` and `docs/agents/`. Those docs point here for
testing conventions; update this guide when test strategy changes.

## Test Layers

- Unit tests cover renderer components, Electron backend services, core schemas, and metadata-engine
  behavior close to the code under test.
- Renderer E2E tests are reserved for a future mocked renderer harness: browser-only scenarios that
  intentionally fake Electron IPC/backend responses to exercise complex UI states.
- Electron E2E tests launch the full Electron app with Playwright and verify renderer, IPC, Electron
  services, SQLite, and the metadata-engine worker together.

Both E2E layers live in `apps/maestro-e2e/`.

Use renderer E2E only when a mocked scenario is the point of the test: feed empty/error/loading states,
settings dirty/save states, import progress streams, scan progress streams, metadata failures, and other
UI state matrices that would be slow or awkward to arrange through the real app. Do not use renderer E2E
for generic routing smoke tests or happy paths that are better covered by full Electron E2E.

A future renderer scenario harness should provide an explicit fake Electron bridge, such as
`ipcRenderer.invoke`, `ipcRenderer.on`, `ipcRenderer.off`, and `ipcRenderer.send`, with scenario fixtures
loaded before Angular bootstraps. Until that exists, keep renderer E2E placeholders skipped.

## Commands

```bash
make test
make test-renderer
make test-electron
make test-core
make test-engine
make e2e
make e2e-renderer
make lint
make format-check
```

Run the narrowest relevant command first. If a change crosses project boundaries, add the affected
project checks after the narrow check passes.

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
