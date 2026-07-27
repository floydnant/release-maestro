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
| Database   | SQLite (better-sqlite3), Drizzle ORM |
| Validation | Zod                                  |
| Scraping   | Cheerio, bandcamp-fetch              |
| Build      | Nx (monorepo), electron-builder      |
| Testing    | Jest (unit), Playwright (E2E)        |

## Prerequisites

- Node.js >= 22.12.0
- npm
- macOS (required for Apple Mail email import; the app itself builds on all platforms)

## Getting Started

```bash
npm i
make dev

# Verifications
make format
make lint
make test
make build
make e2e
make e2e-renderer
```

This starts the Angular dev server and the Electron main process with hot reload.

## Commands

Run `make help` for a list of commands to run. See [docs/testing.md](docs/testing.md) for testing
strategy, E2E conventions, and fixture guidance.

## Documentation

- [CONTEXT-MAP.md](CONTEXT-MAP.md) — the two product contexts (music library, release feed), their
  glossaries in [docs/contexts/](docs/contexts/), and which projects each context spans
- [docs/adr/](docs/adr/) — architectural decisions and the reasoning behind non-obvious ones
- [docs/testing.md](docs/testing.md) — test layers, E2E conventions, fixtures

## Project Structure

```
apps/
  maestro-electron/    Electron main process (backend services, IPC API, database)
  maestro-renderer/    Angular frontend (feed UI, library import, audio player, settings)
  maestro-e2e/          Renderer and full Electron E2E tests
  metadata-engine/     Sidecar worker for reading/writing audio file metadata
libs/
  maestro-core/        Shared library (Zod schemas, types, utilities)
apple-scripts/         AppleScript for exporting emails from Apple Mail
drizzle/               Database migrations
docs/                  ADRs, context glossaries, testing guide
```

Note that the project layout is not the product layout: both product contexts (music library, release
feed) cut across `maestro-electron`, `maestro-renderer`, and `maestro-core`. See
[CONTEXT-MAP.md](CONTEXT-MAP.md).

## Building for Distribution

```bash
make package
```

Produces platform-specific distributables in `dist/executables/`:

| Platform | Format               |
| -------- | -------------------- |
| macOS    | DMG (universal)      |
| Windows  | NSIS installer (x64) |
| Linux    | AppImage             |

## Database

Release Maestro uses SQLite with Drizzle ORM. Migrations live in `drizzle/` and are applied automatically on startup.

To generate a new migration after changing the schema:

```bash
make db-generate
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
