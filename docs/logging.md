# Diagnostic logging

The Electron main process writes diagnostic events to `appPaths.log/main.log`. The file rotates to
`main.old.log` at 5 MiB, so an installation keeps about 10 MiB of logs. Development worktrees use
their own `.app-data.dev/log` directory. `RELEASE_MAESTRO_APP_DATA_DIR` overrides that root for
tests and isolated instances.

The main process owns the file writer. `createMainLogger` writes main-process events, and the typed
`diagnostics:log` IPC channel accepts renderer events. `createRendererLogger` writes every event to
the browser console before sending it to main. The web build keeps the console sink. The Rust
metadata worker writes JSON diagnostics to stderr; the main process reads them one line at a time.
The worker's stdout remains reserved for the JSONL request protocol.

Production files contain `info`, `warn`, and `error` events. Development files also contain `debug`.
Set `RELEASE_MAESTRO_LOG_LEVEL=debug` to include debug events in a packaged app and the Rust worker.
The main-process terminal and renderer DevTools show every level in either mode.

Use a stable event name and scalar fields. Record operation IDs, counts, durations, outcomes, and
error codes at the owner of an operation. Do not log each scan file or import progress tick. Never
pass settings, email content, metadata payloads, whole domain objects, full paths, or URLs to a
logger. The shared logger removes common paths, URLs, and email addresses from strings as a second
line of defense. Review any new string field for private content before adding it.

For import errors, record the error type and code with `diagnosticErrorSummary`. Apple Mail error
messages can contain the configured mailbox name; the full message remains available to the UI.

The production Settings > Diagnostics page shows the latest 20 entries. It can open the log folder
or save a JSONL export of both bounded files. The export adds the app version and platform. It does
not include the database or settings. Users review the export file before sharing it. No log is
uploaded automatically.

Use `pnpm exec nx test maestro-core`, `pnpm exec nx test maestro-electron`, and the Electron
diagnostics E2E spec to check sanitization, the IPC hop, file output, worker forwarding, and export.
The packaged Electron suite checks the production path and file URL build.
