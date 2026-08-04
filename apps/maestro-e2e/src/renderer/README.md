# Renderer Scenario E2E Harness

Renderer scenario tests run the Angular renderer in a normal browser and fake only the Electron IPC
boundary. Use them for UI states that are awkward or slow to arrange through the real app, such as
release feed loading, empty, error, retry, and progress-stream states.

Full Electron E2E still owns real IPC, SQLite, filesystem, and worker integration coverage.

## How It Works

`createRendererScenario(page, scenario)` installs an init script before navigation. The script makes
the browser look enough like Electron for the renderer:

- `window.process.type` is set to `renderer`.
- `window.process.platform` defaults to `darwin`.
- `window.require('electron')` returns a fake `ipcRenderer`.
- No Node modules are mocked. Renderer features that need backend behavior should use typed IPC.

The fake `ipcRenderer` supports:

- `invoke(channel, payload?)` for request/response channels.
- `send(channel, payload?)` for fire-and-forget channels.
- `on`, `off`, and `once` for renderer event streams.

The scenario backend lives in the browser page. Tests control it through the returned
`RendererScenarioController`, which uses `page.evaluate` behind the scenes.

Scenario values are serialized with a tagged JSON codec before they cross the Playwright boundary.
Nested `Date` instances are revived as real `Date` objects in the browser, so fixtures can use dates
without adding channel-specific revival logic.

## Basic Usage

```ts
import { expect, test } from '@playwright/test'
import { createRendererScenario, scenarioBuilder } from './scenario-harness'

test('renders an empty release feed', async ({ page }) => {
    await createRendererScenario(page, scenarioBuilder().feed([], { hasFeed: false }).build())

    await expect(page.getByText('No new releases')).toBeVisible()
})
```

Use role/text locators first. Add `data-testid` only for stable hooks that cannot be expressed as user
visible behavior.

## Builders And Presets

Use inline builders when the scenario is specific to one test:

```ts
const scenario = scenarioBuilder()
    .settings({ emailPluginConfig: { APPLE_MAIL: { mailboxName: 'Bandcamp' } } })
    .feed([createHydratedRelease({ id: 'release-42' })])
    .build()
```

Use presets when the state is common:

```ts
await createRendererScenario(page, rendererScenarios.feed.emptyCaughtUp())
```

Current release feed presets:

- `rendererScenarios.feed.emptyNoSetup()`
- `rendererScenarios.feed.emptyCaughtUp()`
- `rendererScenarios.feed.loadError()`
- `rendererScenarios.feed.withOneRelease()`

Current track list presets:

- `rendererScenarios.tracks.empty()`
- `rendererScenarios.tracks.withSongs()`
- `rendererScenarios.tracks.loadPending()`
- `rendererScenarios.tracks.loadError()`

Track list builders:

- `.songs(rows, { total?, offset? })` serves **one fixed window** whatever is asked for. The
  `total` is what sizes the scrollbar, so passing one far larger than `rows` is how a test
  asserts that scrolling asks for a _different_ window.
- `.songCatalog(page, total)` serves whatever window is asked for — see
  [Computed Answers](#computed-answers).

## Channel Behaviors

Every main-process IPC channel has a default behavior. Override the channels that matter to the test.

```ts
const scenario = scenarioBuilder()
    .handler('get-app-version', { kind: 'resolve', value: '1.2.3-test' })
    .handler('metadata:write', { kind: 'reject', message: 'Write failed' })
    .build()
```

Supported behaviors:

- `{ kind: 'resolve', value }` resolves `ipcRenderer.invoke`.
- `{ kind: 'reject', message }` rejects `ipcRenderer.invoke`.
- `{ kind: 'pending' }` leaves the call unresolved until the test resolves it.
- `{ kind: 'sequence', steps, fallback }` consumes one behavior per call.
- `{ kind: 'respond', responder }` calls back into the test — see below.

## Computed Answers

The behaviors above all carry a value decided before the page loads. That is enough when a
call's answer does not depend on what it asked for, and not enough when it does: a windowed
list requests a different slice on every scroll, and a fixture that ignores the offset can
only prove the table asked correctly, never that it rendered what came back.

`respond()` registers a responder that runs **in Node**, with the request payload:

```ts
const scenario = scenarioBuilder()
    .handler(
        'library:query-songs',
        respond(page, 'first-page-only', (request: QuerySongsRequest) => ({
            rows: request.window.offset === 0 ? createSongRows() : [],
            offset: request.window.offset,
            total: 3,
        })),
    )
    .build()
```

Running in Node is the point: a responder can use `createSongRow` and the real contract
types, which page-side code cannot — the harness is installed through `addInitScript`, so
anything inside it is serialised and cannot reach this module. Only the responder's _name_
crosses the boundary; `page.exposeFunction` bridges the call back.

Register responders **before** `createRendererScenario`, and expect a Node round trip per
answered call.

`scenarioBuilder().songCatalog(page, 50_000)` is the ready-made one: it serves whatever
window is asked for out of a catalog of rows titled `Row 0`, `Row 1`, … Use it when the
assertion is about what the table _renders_; `songs()` serves one fixed window and is right
when the assertion is about what it _requests_.

## Testing Loading And Retry

Use a pending handler when the UI needs to stay in a loading branch:

```ts
const controller = await createRendererScenario(page, scenarioBuilder().feedLoadPending().build())
const release = createHydratedRelease()

await expect(page.getByText('Loading releases...')).toBeVisible()
await controller.resolvePending('load-feed', [release])
await expect(page.getByRole('link', { name: release.data.releaseName })).toBeVisible()
```

Use a sequence when a user action should retry a failed request:

```ts
const scenario = scenarioBuilder()
    .feedLoadSequence([
        { kind: 'resolve', value: { isError: true, name: 'FeedLoadError', message: 'Failed' } },
        { kind: 'resolve', value: [createHydratedRelease()] },
    ])
    .build()
```

## Inspecting Calls

The controller records both `invoke` and `send` calls:

```ts
await expect
    .poll(async () => controller.lastCall('load-feed'))
    .toMatchObject({ channel: 'load-feed', payload: { index: 0, count: 5 } })
```

Available helpers:

- `calls(channel?)`
- `lastCall(channel)`
- `setHandler(channel, behavior)`
- `updateState({ [channel]: behavior })`
- `resolvePending(channel, value?)`
- `emit(channel, payload?)`

## Event Streams

Use `emit` for main-to-renderer events after the app has subscribed:

```ts
await controller.emit('email-import-progress', {
    phase: 'processing',
    current: 2,
    total: 5,
    message: 'Importing Bandcamp notifications',
})
```

This is intended for import progress, metadata scan progress, and other renderer event-stream UI.

## Adding Scenarios

Keep renderer scenario tests focused on mocked backend states. Prefer full Electron E2E when the value
of the test is proving real Electron, SQLite, filesystem, metadata-engine, or OS integration.

When adding reusable data, prefer shared fixture helpers in `scenario-harness.ts` or a sibling fixture
module. Keep data inline only when it is clearly one-off to a single spec.

Run:

```bash
make e2e-renderer
```

If the change also touches renderer components or services, run:

```bash
npx nx test maestro-renderer
```
