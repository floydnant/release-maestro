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

The scan pipeline, the SQLite queries, and the sidecar all run in the main process. A renderer
trace shows none of that work, so most performance questions belong on 5858.
[`profiling`](../profiling/SKILL.md) covers what to measure once you are attached.

Both ports listen on 127.0.0.1. `apps/maestro-electron/project.json` sets them on the
`serve-internal` target, which runs only in development.

## Start the app and confirm both ports

```bash
make dev
curl -s http://127.0.0.1:9222/json/list   # renderer page target
curl -s http://127.0.0.1:5858/json/list   # main process
```

## Drive the renderer through the MCP server

`.mcp.json` points `chrome-devtools-mcp` at port 9222. Prefer its tools over hand-written protocol
calls. `take_snapshot` returns an accessibility tree with stable `uid` refs, a steadier handle on
the UI than a DOM query.

Reach for `list_pages`, `take_snapshot`, `click`, `fill`, `evaluate_script`,
`list_console_messages`, `list_network_requests`, `take_screenshot`, and
`performance_start_trace` with `performance_stop_trace` and `performance_analyze_insight`.

These constraints cost time when you meet them cold:

- `pageId` is a number. `list_pages` reports it.
- Electron has no tabs, so `new_page` fails with `Target.createTarget: Not supported`. One page
  exists and it is already open.
- `list_network_requests` reports traffic from the moment it attached. Attach first, then trigger
  the request, or reload the page.
- `take_heapsnapshot` writes only to a `filePath` inside a workspace root.
- Screenshots are DPR 2 on Retina, so one CSS pixel is two image pixels.

### Other clients

`.mcp.json` is Claude Code's project config. Codex reads `~/.codex/config.toml`, so register the
server once per machine:

```bash
codex mcp add chrome-devtools -- npx -y chrome-devtools-mcp@1.8.0 \
  --browserUrl http://127.0.0.1:9222 --usageStatistics=false
```

Keep `--usageStatistics=false`. The server reports usage data to Google by default.

`@playwright/mcp` suits interaction-heavy work and has no performance tracing. Add it with
`npx -y @playwright/mcp@latest --cdp-endpoint http://127.0.0.1:9222` when you need it. Every
attached server spends context on its tool definitions in every agent.

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

- `make e2e` starts its own renderer on port 4200, so it cannot run while `make dev` holds
  that port. It never binds 9222 or 5858: Playwright launches Electron directly and picks its
  own debug port.
- The renderer dev server binds IPv6 `[::1]:4200`. An IPv4 probe such as `nc -z 127.0.0.1 4200`
  reports it down while it is up. `wait-on tcp:4200` reads it correctly.
- The window is frameless. The window controls are custom DOM, not OS chrome.
- The renderer holds state in Angular signals. After a click, wait for stability before you
  evaluate, or you read the pre-update DOM.
