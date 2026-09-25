<div align=center>
<img src="./apps/maestro-renderer/src/assets/icons/app-icon.png" height="200px">

# Release Maestro

</div>

A desktop app for your music. Scan your local collection into a searchable library, and track new releases from Bandcamp by importing notifications from your inbox — browse both with cover art and full metadata, without leaving the app.

## Tech Stack

| Layer      | Technology                           |
| ---------- | ------------------------------------ |
| Frontend   | Angular, Tailwind CSS, ng-primitives |
| Backend    | Electron, Node.js                    |
| Audio tags | Rust (metadata-engine sidecar)       |
| Database   | SQLite (better-sqlite3), Drizzle ORM |
| Validation | Zod                                  |
| Scraping   | Cheerio, bandcamp-fetch              |
| Build      | Nx (monorepo), electron-builder      |
| Testing    | Jest (unit), Playwright (E2E)        |

## Prerequisites

- Node.js (use the version in `.node-version`)
- pnpm (if the command is unavailable, enable the Node.js-provided launcher with
  `corepack enable pnpm`)
- A Rust toolchain (`cargo` and `rustc`) for the metadata-engine sidecar. Development builds only the
  host architecture; `make dev` does not require `rustup`.
- `rustup` for macOS packaging, which builds the sidecar for both Apple Silicon and Intel
- macOS (required for Apple Mail email import; the app itself builds on all platforms)

## Getting Started

```bash
make install # or make i
make dev
```

Node.js, pnpm, and Rust are required. `.node-version` selects the development and CI Node.js
version, while `package.json` declares the supported range and project pnpm release. Use `pnpm`
normally; pnpm downloads and runs the project's declared release when necessary. `make install`
installs the root package from the lockfile, fetches the locked Rust crates, and installs Playwright
Chromium with its system dependencies. Linux system dependencies may require sudo. Chromium
requires an OS supported by the installed Playwright version.

`make dev` builds the host metadata-engine binary and starts the Angular dev server and Electron
main process with hot reload. The host binary lives in `apps/metadata-engine/target-dev/release`,
separate from the packaging binary in `target/release`. Development always uses this host path.
If the host binary is missing, rebuild it with the command below; old release or debug builds are not used.

Each Git worktree gets stable debug ports, its own `.app-data.dev`, and a slot number in the Electron
window title. Use `make dev-status` for this worktree, `make dev-list` for all worktrees, and
`make dev-log` for orchestration events. Allocations remain reserved for 20 minutes after use.

To replace an idle allocation with a manual bundle, set all three ports:

```bash
RELEASE_MAESTRO_RENDERER_PORT=4300 \
RELEASE_MAESTRO_CDP_PORT=9300 \
RELEASE_MAESTRO_INSPECTOR_PORT=5900 \
make dev-reallocate
```

Codex and Claude Code use the same advisory session hook. Codex asks you to review the project hook
in `/hooks` because it records trust against the command hash. Claude Code applies its normal project
settings approval. Declining either hook does not break allocation or cleanup. The MCP wrappers in
`.mcp.json` and `.codex/config.toml` resolve the current worktree's CDP endpoint when they start.

Use `pnpm exec nx build metadata-engine` to build only the host sidecar.

`make dev` also opens local debug endpoints for agent inspection. See
[`inspect-running-app`](.agents/skills/inspect-running-app/SKILL.md) for attachment and profiling.

## Commands

`make` is the repo-wide interface — run `make help` for the full list. It is what CI runs.

```bash
make sure          # format, lint, build, unit test, development Electron/renderer E2E
make affected      # build, lint, unit/E2E tests for affected projects; no formatting
make format-check  # non-mutating formatting check
make e2e           # full Electron E2E against the development build
make e2e-production # package and test the production desktop app for this OS
make e2e-renderer  # renderer-only E2E (type-checks itself first)
```

Dev stack instance manager

```bash
make dev-status    # show this worktree's ports, resources, and process holders
make dev-list      # show instances across every registered worktree
make dev-stop      # stop validated development processes from this worktree
make dev-log       # print colored events; FOLLOW=1 follows, JSON=1 emits JSONL
make dev-instance-self-test # verify the manager with two live worktrees
```

`make sure` mutates formatting. Electron E2E and renderer E2E may run together. The instance manager
rejects Electron E2E while `make dev` owns the same worktree's development build output.

After installation, run `make agents-check` to validate the agent skills and harness adapters and run
their fixture tests.

For focused work, use Nx; see the [fast-iteration examples](docs/testing.md#fast-iteration) for file
and test-name filters.

```bash
pnpm exec nx test maestro-renderer
pnpm exec nx lint maestro-electron
pnpm exec nx build maestro-core
```

There is no repo-wide typecheck target; `build` is the type gate for app code. See
[docs/testing.md](docs/testing.md) for testing strategy, E2E conventions, and fixture guidance.

## Documentation

- [CONTEXT-MAP.md](CONTEXT-MAP.md) — the two product contexts (music library, release feed), their
  glossaries in [docs/contexts/](docs/contexts/), and which projects each context spans
- [docs/adr/](docs/adr/) — architectural decisions and the reasoning behind non-obvious ones
- [docs/testing.md](docs/testing.md) — test layers, E2E conventions, fixtures

## Projects

Five Nx projects, whose names are not self-explanatory:

- **`maestro-electron`** — Electron main process: backend services, the IPC API, the database.
- **`maestro-renderer`** — Angular frontend: feed UI, library import, audio player, settings.
- **`maestro-core`** — shared Zod schemas and types. The contract for everything crossing the
  main/renderer and metadata-engine boundaries.
- **`metadata-engine`** — Rust sidecar that reads and writes audio file tags.
- **`maestro-e2e`** — renderer and full-Electron E2E, including packaged-app coverage.

`apple-scripts/` holds the AppleScript that exports mail out of Apple Mail; `drizzle/` holds
migrations. A project's `project.json` declares its explicit configuration, but Nx can infer
additional targets. Use `pnpm exec nx show project <project> --web false` for the effective project and
target inventory.

Note that the project layout is not the product layout: both product contexts (music library, release
feed) cut across `maestro-electron`, `maestro-renderer`, and `maestro-core`. See
[CONTEXT-MAP.md](CONTEXT-MAP.md).

## Building for Distribution

```bash
make package
```

On macOS, packaging requires `rustup` to install both Rust targets and creates a universal sidecar.
`make package-dir`, `make package`, and `make build-engine` use the packaging-only
`metadata-engine:build-package` target and retain that requirement.

Produces platform-specific distributables in `dist/executables/`:

| Platform | Format               |
| -------- | -------------------- |
| macOS    | DMG (universal)      |
| Windows  | NSIS installer (x64) |
| Linux    | AppImage             |

## Database

Release Maestro uses SQLite with Drizzle ORM. Migrations live in `drizzle/` and are applied automatically on startup.

To generate a new migration after changing the schema — the name is required:

```bash
make db-generate NAME=add_users_table
```

Not all state lives in SQLite. User settings are a `conf` file in the app's **config** dir; library
scan state (`library-state.json`) is a separate `conf` file in the **data** dir, because it is derived
state that belongs with the database rather than user configuration
([ADR 0001](docs/adr/0001-main-process-owns-scan-lifecycle.md)). To reset just the library — song
tables plus that sidecar, leaving migrations and the release feed intact:

```bash
make db-truncate-library
```

## License

Copyright (c) 2026 Floyd Haremsa. All rights reserved for the original,
project-specific code in this repository. A small set of scaffold-derived files
is excluded pending rewrite and/or third-party notice cleanup. See
[LICENSE.md](LICENSE.md).
