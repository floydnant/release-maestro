# Testing Guide

Use Nx for focused work and Make for repo-wide verification. The `Makefile` is the public interface
used by CI; `pnpm exec nx show project <project> --web false` is authoritative for one project's targets.
The [`e2e-testing`](../.agents/skills/e2e-testing/SKILL.md) skill adds Playwright authoring guidance.

## Choose the layer

Run `make install` or `make i` to install the pnpm packages, fetch Rust crates, and install Playwright
Chromium with its system dependencies before running the checks below.

- Unit tests cover renderer components, Electron services, core schemas, and metadata-engine behavior
  close to the code under test.
- Metadata-engine E2E tests run its compiled Rust worker over JSONL against independently authored
  audio fixtures. They run with `pnpm exec nx test metadata-engine`, alongside its unit and protocol tests.
  See [the metadata fixtures](../fixtures/metadata/README.md) for coverage and regeneration.
- Renderer E2E uses a browser with mocked Electron IPC. Use it for UI state matrices—loading, empty,
  error, retry, settings, and progress—that are awkward to arrange through the real app.
- Electron E2E launches the full app and covers renderer, IPC, filesystem, SQLite, and the metadata
  worker together. Use it for critical happy paths and integration boundaries, not every UI branch.
- Scale checks seed SQLite directly and assert query plans rather than wall time. Browse surfaces are
  designed for 50k–500k songs ([ADR 0004](adr/0004-browse-queries-are-windowed-and-selections-carry-a-query.md));
  adding a sortable column means adding its index and a case to `library-browse.scale.spec.ts`.

Both application E2E layers live in `apps/maestro-e2e/`. Do not use renderer E2E for routing smoke tests or happy
paths that need real IPC, files, database state, or the sidecar.

### Renderer scenario harness

`apps/maestro-e2e/src/renderer/scenario-harness.ts` installs a browser-side Electron IPC fake before
Angular starts. Scenario responders can run in Node when an answer depends on the request, such as a
windowed query. See [the harness README](../apps/maestro-e2e/src/renderer/README.md) for builders,
presets, pending handlers, sequences, and computed responders.

Pure scenario helpers have Jest tests in `src/renderer/**/*.test.ts`. Run them with
`pnpm exec nx test maestro-e2e`; `make test` and `make sure` include this target. Playwright owns
`*.spec.ts`, including the browser integration contract in `harness/scenario-ipc.spec.ts`.

Do not mock Node modules such as `fs` or `child_process` in renderer E2E; renderer behavior should use
typed IPC. The default scenario has a configured library folder so unrelated tests are not redirected
to onboarding. Override `get-settings` when onboarding is the scenario under test.

## Fast iteration

Filtered runs are encouraged while iterating. They do not replace the relevant project or suite check
before handoff.

Jest-based unit test, filtered by file and test name:

```bash
pnpm exec nx test maestro-renderer --runInBand \
  --testPathPatterns=app.routes.spec.ts \
  --testNamePattern="includes debug"
```

Playwright spec and title filtering through Nx:

```bash
# Renderer E2E
pnpm exec nx run maestro-e2e:e2e-renderer -- \
  apps/maestro-e2e/src/renderer/feed/feed-playback.spec.ts \
  --grep "plays and seeks"

# Full Electron E2E against the development build
pnpm exec nx run maestro-e2e:e2e -- \
  apps/maestro-e2e/src/electron/library-import.spec.ts \
  --grep "library routes are available"

# Full Electron E2E against the packaged production app
pnpm exec nx run maestro-e2e:e2e-production -- \
  apps/maestro-e2e/src/electron/library-import.spec.ts \
  --grep "library routes are available"
```

## Widen before handoff

Run the narrowest relevant check first, then widen according to the changed boundary:

```bash
pnpm exec nx test maestro-renderer     # one project's unit suite
pnpm exec nx build maestro-electron    # build/type gate for one project
make e2e-renderer                      # renderer scenario suite
make e2e                               # full development Electron suite
make e2e-production                    # cached package + production Electron suite
make format-check                      # non-mutating repo formatting check
make affected                          # affected build/lint/unit/development-Electron/renderer checks
make sure                              # formats, then lint/build/unit/development Electron/renderer E2E
```

`make sure` mutates formatting. `make e2e-production` remains separate because it packages the app,
excludes the development-only debug-console spec, and checks file-URL routing, lazy chunks, and
cross-platform packaging behavior.

Production packaging is cached. The launcher resolves electron-builder's unpacked layout on macOS,
Windows, and Linux, and CI runs the production suite on all three. E2E windows remain visible but
unfocused by default, so a screenshot of a test run never steals focus; set
`RELEASE_MAESTRO_E2E_BACKGROUND=0` to activate the window while debugging.

To inspect the development app rather than a test run, attach to the debug ports `make dev` opens.
The [`inspect-running-app`](../.agents/skills/inspect-running-app/SKILL.md) skill owns that
workflow. Reach for it before you write a throwaway spec to look at something.

Electron creates its browser context outside Playwright Test's managed browser fixtures, so
`launch-release-maestro.ts` starts context tracing explicitly and attaches the archive when the app
closes. The trace includes timeline screenshots, DOM snapshots, network activity, and sources. A test
that relaunches the app has one trace attachment per launch. Use `make e2e-show-report` to inspect
them. Standalone screenshots are for on-demand visual review of the running app, not routine E2E
diagnostics; keep one-off captures out of committed behavioral specs.

### Type checking

For buildable projects—renderer, Electron, and core—the build is the type gate. A green Jest run is
not a type check. Projects with nothing to build expose a `typecheck` target; all E2E targets depend on
`maestro-e2e:typecheck`, and `make typecheck-e2e` runs it alone.

## E2E conventions

Use locators in this order:

1. Role and accessible name.
2. Label.
3. Visible text when the text is the user contract.
4. `data-testid` only for non-user-facing hooks or values that cannot be made accessible cleanly.

Use web-first assertions such as `await expect(locator).toBeVisible()`. Each test must run alone, with
fresh state arranged in `beforeEach` or the test itself.

### Wait for outcomes, not time

An action finishing does not mean the application has finished reacting to it. A click, key press,
scroll, route change, IPC response, or resize may schedule more work after Playwright returns. Wait
for the user-visible or boundary-level outcome that the test cares about.

- Prefer locator assertions such as `toBeVisible`, `toBeFocused`, `toHaveValue`, and `toHaveURL`.
  They retry until the state is true.
- Use `expect.poll` for state without a locator, such as IPC calls, requested query windows, scroll
  geometry, or values read with `evaluate`. A polling callback should return `undefined` or another
  incomplete value while work is pending. It should not throw merely because the result has not
  arrived yet.
- Send input through the locator that owns it when rendering may replace DOM nodes. For example,
  prefer `await tile.press('ArrowRight')` over focusing a tile and later calling
  `page.keyboard.press`. The latter can send the key to `body` if virtualization replaces the tile
  between those calls.
- For virtualized lists, assert the logical place: the expected row or tile is visible and the data
  source received the expected window. Assert an exact `scrollTop` only when the pixel offset itself
  is the product contract. A virtualizer may preserve the same item while reanchoring its local
  scroll offset.
- When inspecting recorded calls, wait for the source page to settle before taking a baseline and
  filter calls to the route or entity under test. Navigation can leave a final request from the page
  being replaced.
- Do not use `waitForTimeout`, larger timeouts, retries, or reduced motion to make a race pass. They
  change how often the race occurs without defining when the application is ready.

The suites use the browser's default `no-preference` motion setting. This keeps transitions and
animations in the normal execution path. A test for reduced-motion behavior should opt in with
`page.emulateMedia({ reducedMotion: 'reduce' })` and restore `no-preference` when it finishes. A test
for animation behavior should wait for the resulting DOM state or event instead of its nominal
duration.

When a test has failed only in CI, repeat the smallest affected slice locally with retries disabled.
This does not prove the race is gone, but it catches fixes that only move it into Playwright's retry:

```bash
pnpm exec nx run maestro-e2e:e2e-renderer -- \
  apps/maestro-e2e/src/renderer/library/albums.spec.ts \
  --grep "moves between tiles" --repeat-each=10 --retries=0
```

Electron E2E must isolate filesystem inputs and app state:

- Copy committed media into a fresh temporary library; never mutate source fixtures.
- Launch with a fresh `RELEASE_MAESTRO_APP_DATA_DIR` so database, config, cache, logs, and temp files
  cannot leak between tests.
- Keep full-app tests broad but few.

## Fixtures

Reusable fixtures live in `fixtures/`. Generate tagged scan libraries with
`apps/maestro-e2e/src/fixtures/tagged-library.fixture.ts` rather than committing similar binaries.
Renderer playback serves the committed MP3 through `audio.fixture.ts`; do not replace it with a remote
URL because the playback regression deliberately puts Chromium offline.
