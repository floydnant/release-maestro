# Domain Docs

How the engineering skills should consume this repo's domain documentation when exploring the codebase.

## Before exploring, read these

- `CONTEXT-MAP.md` at the repo root. It points at one `CONTEXT.md` per context.
- `CONTEXT.md` for the relevant context, using the map to find it.
- `docs/adr/` for architectural decisions.

If a file or directory does not exist, proceed silently.

This repo has two contexts, both under `docs/contexts/`: the music library and the release feed. Pick the glossary matching what you are working on — the two share infrastructure but not vocabulary. Add further glossaries lazily if another area develops its own.

Contexts are product boundaries, not Nx projects: each one spans the Electron main process, the Angular renderer, and the shared core lib. Do not look for a per-project `CONTEXT.md` or a per-project `docs/adr/` — decisions live in the single root `docs/adr/` for the same reason.

For test-layer conventions, E2E isolation, fixture handling, and CI guidance, see `docs/testing.md`.

## Repository structure

This repo is an Nx monorepo. The active projects are:

- `apps/maestro-electron/` for the Electron main process, IPC, and backend services
- `apps/maestro-renderer/` for the Angular renderer UI
- `apps/maestro-e2e/` for Playwright end-to-end tests across renderer-only and full Electron flows
- `apps/metadata-engine/` for reading/writing audio file tags
- `libs/maestro-core/` for shared schemas, types, and utilities

Supporting areas:

- `drizzle/` for database migrations and metadata
- `apple-scripts/` for Apple Mail export automation
- `scripts/` for repo maintenance scripts

When in doubt, treat `README.md` as the high-level overview and the per-project `project.json` files as the source of truth for project boundaries and targets.

## Use the glossary's vocabulary

When your output names a domain concept, use the term as defined in the relevant `CONTEXT.md`. Don't drift to synonyms the project explicitly avoids.

If the concept you need isn't in the glossary yet, that's a signal — either you're inventing language the project doesn't use or there's a real gap to capture.

## Flag ADR conflicts

If your output contradicts an existing ADR, surface it explicitly rather than silently overriding it.
