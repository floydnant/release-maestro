---
name: inspect-running-app
description: Attach Chrome DevTools to the running dev app to inspect the DOM, console, and network, click through a flow, or capture a screenshot. Use when reproducing a bug by hand against `make dev`. For CPU, trace, and memory work use `profiling`; for committed Playwright specs use `e2e-testing`.
---

# Inspect the running app

`make dev` opens two worktree-specific debug ports. They speak different protocols and answer
different questions. Run `make dev-status` first and use the ports it prints.

| Status field | Protocol                 | Answers                                                              |
| ------------ | ------------------------ | -------------------------------------------------------------------- |
| CDP          | Chrome DevTools Protocol | renderer DOM, clicks, console, network, renderer traces, screenshots |
| inspector    | Node inspector           | main-process CPU and heap profiles, Electron APIs, native dialogs    |

[`profiling`](../profiling/SKILL.md) covers choosing a process and what to measure once attached.

Both ports listen on loopback. The development-instance wrapper passes them to the
`serve-internal` target, which runs only in development.
Debugging stays enabled in dev so an agent can attach to an existing session without restarting
the app and losing the state it needs to inspect. Packaged builds do not use this executor.

## Start the app and confirm both ports

Start the app in one terminal:

```bash
make dev
```

After it prints its startup summary, check the ports in another terminal:

```bash
status="$(make --silent dev-status JSON=1)"
cdp_port="$(node -p 'JSON.parse(process.argv[1]).bundle.cdp' "$status")"
inspector_port="$(node -p 'JSON.parse(process.argv[1]).bundle.inspector' "$status")"
curl -s "http://127.0.0.1:${cdp_port}/json/list"
curl -s "http://127.0.0.1:${inspector_port}/json/list"
```

Open `http://localhost:<renderer port>` using the port from `make dev-status`. If another program takes a persisted port,
startup fails and tells you to run `make dev-reallocate`. It does not move an active MCP endpoint.

## Drive the renderer through the MCP server

`.mcp.json` and `.codex/config.toml` launch the repository MCP wrapper. It resolves this worktree's
CDP port when the server starts, so separate worktrees need no config rewrites. Prefer its tools over
hand-written protocol calls. `take_snapshot` returns an accessibility tree with stable `uid` refs, a
steadier handle on the UI than a DOM query.

These constraints cost time when you meet them cold:

- `pageId` is a number. `list_pages` reports it.
- Electron has no tabs, so `new_page` fails with `Target.createTarget: Not supported`. One page
  exists and it is already open.
- `list_network_requests` reports traffic from the moment it attached. Attach first, then trigger
  the request, or reload the page.
- Browse snapshots can contain hundreds of grid nodes. Filter first, or use `evaluate_script` for
  one narrow fact.
- Screenshots are DPR 2 on Retina, so one CSS pixel is two image pixels.

### Client configuration

Claude Code uses `.mcp.json`; Codex uses `.codex/config.toml` after the project is trusted.
Both configs include the memory tools used by `profiling`. Restart the client after changing
its server configuration. Codex's `/mcp` shows the active servers.

Run `make install` before starting an agent client from the repository root. Both wrappers use
`pnpm exec` to run the installed MCP package, so the dependency manifest and lockfile control its
version. Dependency updates take effect after reinstalling and restarting the client.
If dependencies are missing, startup fails without downloading a fallback package.

Keep `--usageStatistics=false`. The server reports usage data to Google by default.
Both clients enable this server for the project, including its extra heap tools. Those tool
definitions cost context even when the app is not running; browser attachment is lazy.

For interaction-heavy work, opt into the repository's pinned Playwright MCP server. Codex disables
it in `.codex/config.toml` so its tools do not consume context by default; start a session with
`codex -c mcp_servers.playwright.enabled=true`. Claude asks each user to approve project servers
from `.mcp.json`; leave Playwright unapproved until a task needs it. Other clients can run the same
repository wrapper:

```text
node tools/dev-instance/mcp-wrapper.mjs playwright
```

Keep Chrome DevTools MCP as the default because Playwright MCP does not provide performance traces.

Prefer exact accessible names for navigation links, such as
`getByRole('link', { name: 'Tracks', exact: true })`; result cards can include the same word.

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
It reads the renderer console; startup and main-process logs stay in the `make dev` terminal.
For a Lighthouse accessibility audit, use `lighthouse_audit` with `mode: "snapshot"` to audit
the current state without reloading. Read failures from the JSON report path returned by the
tool; `outputDirPath` specifies a directory, not a report filename. Automated audits supplement
the keyboard and focus checks.

## Reach a port directly

Node 22 has a global `WebSocket`, so raw protocol access needs nothing installed. Use it when no
MCP server is available, and for main-process work, which no MCP server drives.

```js
const page = (await (await fetch('http://127.0.0.1:<CDP>/json/list')).json()).find(t => t.type === 'page')
const ws = new WebSocket(page.webSocketDebuggerUrl)
// Runtime.enable, then Runtime.evaluate with returnByValue and awaitPromise
```

The main process answers the same way at `http://127.0.0.1:<inspector>/json/list`. For CPU profiles, heap
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

Stop the `make dev` process normally. If its supervisor exited first, inspect and stop only this
worktree's validated holders:

```bash
make dev-status
make dev-stop
```

A finding worth keeping belongs in a committed Playwright spec. See `e2e-testing`.

## Gotchas

- `make e2e` refuses to start while `make dev` owns the Electron development output. Renderer E2E
  stays compatible with both. The rejection names the conflicting workflow and holder.
- The window is frameless. The window controls are custom DOM, not OS chrome.
- The renderer holds state in Angular signals. After a click, wait for stability before you
  evaluate, or you read the pre-update DOM.
