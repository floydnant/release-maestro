---
name: inspect-running-app
description: Attach Chrome DevTools to the running dev app to inspect the DOM, console, and network, click through a flow, or capture a screenshot. Use when reproducing a bug by hand against `make dev`. For CPU, trace, and memory work use `profiling`; for committed Playwright specs use `e2e-testing`.
---

# Inspect the running app

`make dev` opens two debug ports. They speak different protocols and answer different questions,
and reaching for the wrong one is the usual first mistake.

| Port | Protocol                 | Answers                                                              |
| ---- | ------------------------ | -------------------------------------------------------------------- |
| 9222 | Chrome DevTools Protocol | renderer DOM, clicks, console, network, renderer traces, screenshots |
| 5858 | Node inspector           | main-process CPU and heap profiles, Electron APIs, native dialogs    |

[`profiling`](../profiling/SKILL.md) covers choosing a process and what to measure once attached.

Both ports listen on 127.0.0.1. `apps/maestro-electron/project.json` sets them on the
`serve-internal` target, which runs only in development.
Debugging stays enabled in dev so an agent can attach to an existing session without restarting
the app and losing the state it needs to inspect. Packaged builds do not use this executor.

## Start the app and confirm both ports

Before starting, use `lsof -nP -iTCP:9222,5858,4200 -sTCP:LISTEN` to identify existing listeners.
Port 9222 is also commonly used by Chrome. Reuse an app only after checking its process command
and checkout path with `ps -p <pid> -o command=`. Do not attach to an unrelated listener.

```bash
make dev
curl -s http://127.0.0.1:9222/json/list   # renderer page target
curl -s http://127.0.0.1:5858/json/list   # main process
```

Wait for a renderer page at `http://localhost:4200`. Before evaluating scripts, confirm the
listener's process command names this checkout's `dist/apps/maestro-electron/main.js`; the Node
discovery response can report only `file://`, so its URL alone cannot identify the checkout.

## Drive the renderer through the MCP server

`.mcp.json` and `.codex/config.toml` point `chrome-devtools-mcp` at port 9222. Prefer its tools
over hand-written protocol calls. `take_snapshot` returns an accessibility tree with stable `uid` refs, a steadier handle on
the UI than a DOM query.

These constraints cost time when you meet them cold:

- `pageId` is a number. `list_pages` reports it.
- Electron has no tabs, so `new_page` fails with `Target.createTarget: Not supported`. One page
  exists and it is already open.
- `list_network_requests` reports traffic from the moment it attached. Attach first, then trigger
  the request, or reload the page.
- `take_heapsnapshot` writes only to a `filePath` inside a workspace root.
- Screenshots are DPR 2 on Retina, so one CSS pixel is two image pixels.

### Client configuration

Claude Code uses `.mcp.json`; Codex uses `.codex/config.toml` after the project is trusted.
Both configs include the memory tools used by `profiling`. Restart the client after changing
its server configuration. Codex's `/mcp` shows the active servers.

Keep the executable version in both configs aligned with `package.json` when updating it.
Explicit pins make startup reproducible even before dependencies are installed.

Keep `--usageStatistics=false`. The server reports usage data to Google by default.
Both clients enable this server for the project, including its extra heap tools. Those tool
definitions cost context even when the app is not running; browser attachment is lazy.

`@playwright/mcp` suits interaction-heavy work and has no performance tracing. Add it with
`npx -y @playwright/mcp@latest --cdp-endpoint http://127.0.0.1:9222` when you need it.

The upstream skills ship under `node_modules/chrome-devtools-mcp/skills/`. These local skills
adapt them for Electron: attach to the existing window, use the separate Node inspector for
main-process work, and stub native dialogs. Upstream browser launch, new-tab, and extension
workflows do not apply to this app.

## Audit the current screen

Use [`frontend-design`](../frontend-design/SKILL.md) for the accessibility requirements.
Inspect names and reading order with `take_snapshot`, then exercise keyboard navigation with
`press_key` and check focus after each step.

`list_console_messages` with `types: ["issue"]` adds Chrome's reported issues. Set
`includePreservedMessages: true` only when issues from the last three navigations are relevant.
For a Lighthouse accessibility audit, use `lighthouse_audit` with `mode: "snapshot"` to audit
the current state without reloading. Read failures from the JSON report path returned by the
tool; `outputDirPath` specifies a directory, not a report filename. Automated audits supplement
the keyboard and focus checks.

## Reach a port directly

Node 22 has a global `WebSocket`, so raw protocol access needs nothing installed. Use it when no
MCP server is available, and for main-process work, which no MCP server drives.

```js
const page = (await (await fetch('http://127.0.0.1:9222/json/list')).json()).find(t => t.type === 'page')
const ws = new WebSocket(page.webSocketDebuggerUrl)
// Runtime.enable, then Runtime.evaluate with returnByValue and awaitPromise
```

The main process answers the same way at `http://127.0.0.1:5858/json/list`. For CPU profiles, heap
snapshots, and performance traces, see [`profiling`](../profiling/SKILL.md).

**`Runtime.evaluate` on the main process needs `includeCommandLineAPI: true`.** Without it
`require` is undefined, `process.mainModule` is undefined too because the main process is a webpack
bundle, and every `require('electron')` throws a `TypeError` that points nowhere near the cause.

## Get past the folder picker

CDP cannot drive a native dialog, and `library:pick-folders` opens one that blocks onboarding.

Stub that one dialog in the main process, then use the app as a user would. Canonicalization,
settings persistence, and the scan all stay on the real path:

```js
const { dialog } = require('electron') // needs includeCommandLineAPI: true
dialog.showOpenDialog = async () => ({ canceled: false, filePaths: ['/abs/path/to/library'], bookmarks: [] })
```

Then click the real browse button and continue through the flow.

Invoking `library:start-scan` from the renderer looks faster and costs more. It skips
`saveFolders`, so the folder never reaches settings and onboarding never finishes, leaving a state
the app cannot reach on its own. Save direct IPC for reading state, such as
`library:get-scan-status` and `get-settings`.

## Finish the session

Stop `make dev` and check that nothing still holds the ports:

```bash
lsof -nP -iTCP:9222,5858,4200 -sTCP:LISTEN
```

A finding worth keeping belongs in a committed Playwright spec. See `e2e-testing`.

## Gotchas

- If an Electron-based agent client passes `ELECTRON_RUN_AS_NODE=1` to its shell, Electron
  rejects `--remote-debugging-port` as a Node option. Launch with
  `env -u ELECTRON_RUN_AS_NODE make dev` to clear it for that command.
- Stop `make dev` before `make e2e`. Locally, Playwright can reuse the renderer on port 4200,
  but the dev watcher and E2E build share `dist/apps/maestro-electron/main.js`; a rebuild can
  replace the bundle while a test launches it. Playwright launches Electron directly with
  its own debug port, so the test app is not the target on 9222 or 5858.
- The renderer dev server binds IPv6 `[::1]:4200`. An IPv4 probe such as `nc -z 127.0.0.1 4200`
  reports it down while it is up. `wait-on tcp:4200` reads it correctly.
- The window is frameless. The window controls are custom DOM, not OS chrome.
- The renderer holds state in Angular signals. After a click, wait for stability before you
  evaluate, or you read the pre-update DOM.
