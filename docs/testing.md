# Testing Guide

Use Nx for focused work and Make for repo-wide verification. The `Makefile` is the public interface
used by CI; `npx nx show project <project> --web false` is authoritative for one project's targets.
The [`e2e-testing`](../.agents/skills/e2e-testing/SKILL.md) skill adds Playwright authoring guidance.

## Choose the layer

- Unit tests cover renderer components, Electron services, core schemas, and metadata-engine behavior
  close to the code under test.
- Renderer E2E uses a browser with mocked Electron IPC. Use it for UI state matrices—loading, empty,
  error, retry, settings, and progress—that are awkward to arrange through the real app.
- Electron E2E launches the full app and covers renderer, IPC, filesystem, SQLite, and the metadata
  worker together. Use it for critical happy paths and integration boundaries, not every UI branch.
- Scale checks seed SQLite directly and assert query plans rather than wall time. Browse surfaces are
  designed for 50k–500k songs ([ADR 0004](adr/0004-browse-queries-are-windowed-and-selections-carry-a-query.md));
  adding a sortable column means adding its index and a case to `library-browse.scale.spec.ts`.

Both E2E layers live in `apps/maestro-e2e/`. Do not use renderer E2E for routing smoke tests or happy
paths that need real IPC, files, database state, or the sidecar.

### Renderer scenario harness

`apps/maestro-e2e/src/renderer/scenario-harness.ts` installs a browser-side Electron IPC fake before
Angular starts. Scenario responders can run in Node when an answer depends on the request, such as a
windowed query. See [the harness README](../apps/maestro-e2e/src/renderer/README.md) for builders,
presets, pending handlers, sequences, and computed responders.

Do not mock Node modules such as `fs` or `child_process` in renderer E2E; renderer behavior should use
typed IPC. The default scenario has a configured library folder so unrelated tests are not redirected
to onboarding. Override `get-settings` when onboarding is the scenario under test.

## Fast iteration

Filtered runs are encouraged while iterating. They do not replace the relevant project or suite check
before handoff.

Jest-based unit test, filtered by file and test name:

```bash
npx nx test maestro-renderer --runInBand \
  --testPathPatterns=app.routes.spec.ts \
  --testNamePattern="includes debug"
```

Playwright spec and title filtering through Nx:

```bash
# Renderer E2E
npx nx run maestro-e2e:e2e-renderer -- \
  apps/maestro-e2e/src/renderer/feed/feed-playback.spec.ts \
  --grep "plays and seeks"

# Full Electron E2E against the development build
npx nx run maestro-e2e:e2e -- \
  apps/maestro-e2e/src/electron/library-import.spec.ts \
  --grep "library routes are available"

# Full Electron E2E against the packaged production app
npx nx run maestro-e2e:e2e-production -- \
  apps/maestro-e2e/src/electron/library-import.spec.ts \
  --grep "library routes are available"
```

## Widen before handoff

Run the narrowest relevant check first, then widen according to the changed boundary:

```bash
npx nx test maestro-renderer  # one project's unit suite
npx nx build maestro-electron # build/type gate for one project
make e2e-renderer             # renderer scenario suite
make e2e                      # full development Electron suite
make e2e-production           # cached package + production Electron suite
make format-check             # non-mutating repo formatting check
make affected                 # affected build/lint/unit/development-Electron/renderer checks
make sure                     # formats, then lint/build/unit/development Electron/renderer E2E
```

`make sure` mutates formatting. `make e2e-production` remains separate because it packages the app,
excludes the development-only debug-console spec, and checks file-URL routing, lazy chunks, and
cross-platform packaging behavior.

Production packaging is cached. The launcher resolves electron-builder's unpacked layout on macOS,
Windows, and Linux, and CI runs the production suite on all three. E2E windows remain visible but
unfocused by default so an agent can capture the running app on demand without stealing focus; set
`RELEASE_MAESTRO_E2E_BACKGROUND=0` to activate the window while debugging.

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
