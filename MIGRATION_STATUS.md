# Nx Migration — Complete

The project has been fully migrated from a standalone Angular+Electron setup to an Nx monorepo.

## Workspace Structure

| Project | Path | Description |
|---------|------|-------------|
| `maestro-electron` | `apps/maestro-electron/` | Electron main process |
| `maestro-renderer` | `apps/maestro-renderer/` | Angular renderer (frontend) |
| `maestro-core` | `libs/maestro-core/` | Shared library (schemas, utils, exceptions) |

## Commands

| Command | Description |
|---------|-------------|
| `npm run dev` | Start dev server (electron + renderer with hot reload) |
| `npm run build:prod` | Production build |
| `npm run electron:build` | Build + package with electron-builder |
| `npx nx test <project>` | Run tests for a specific project |
| `npx nx lint <project>` | Lint a specific project |

## What Changed

- All business logic moved from `app/` to `apps/maestro-electron/src/app/`
- Shared schemas/types extracted to `libs/maestro-core/` (import via `@release-maestro/core`)
- Build pipeline uses Nx executors (`nx-electron`, `@angular/build`, `@nx/js`)
- Legacy `app/` directory removed
- Legacy dependencies removed (`npm-run-all`, `@angular-builders/custom-webpack`, etc.)
