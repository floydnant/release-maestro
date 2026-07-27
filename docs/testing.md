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

```bash
make test
make test-renderer
make test-electron
make test-core
make test-engine
make e2e
make e2e-renderer
make typecheck-e2e
make lint
make format-check
```

Playwright transpiles tests but does not perform semantic TypeScript checking. The `maestro-e2e:typecheck`
target runs `tsc --noEmit` over both Electron and renderer E2E sources; CI invokes it through
`make typecheck-e2e`.

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

### Generated media over committed media

Library scan tests need many distinctly-tagged audio files with distinct cover art. Committing them
would mean megabytes of near-identical binaries in every checkout, so
`apps/maestro-e2e/src/fixtures/tagged-library.fixture.ts` **generates** a temp library at test time by
re-tagging the audio of the single committed MP3 fixture. Prefer extending that generator over adding
binary fixtures.

Two details there are load-bearing and easy to break:

- Cover art is deduped by content hash, so identical images collapse to one album preview. The
  generator appends salt bytes after each PNG's `IEND` chunk — invisible to decoders, but enough to
  make otherwise-identical covers hash differently. Two albums deliberately share a salt so the dedup
  path stays covered.
- The default library is shaped for assertions (6 tracks, 4 albums, 3 distinct artworks). Changing
  those counts will break tests that assert on them rather than just the tests you are editing.
