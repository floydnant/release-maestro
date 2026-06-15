# Domain Docs

How the engineering skills should consume this repo's domain documentation when exploring the codebase.

## Before exploring, read these

- `CONTEXT-MAP.md` at the repo root, if it exists. It points at one `CONTEXT.md` per context.
- `CONTEXT.md` files for the relevant context, using the map when present.
- `docs/adr/` for system-wide architectural decisions.
- `apps/*/docs/adr/` and `libs/*/docs/adr/` for context-specific decisions when they exist.

If a file or directory does not exist, proceed silently.

This repo currently has a root `CONTEXT.md` seed glossary. Add context-specific glossaries lazily if a project area develops its own vocabulary that would make the root glossary noisy.

If a context needs its own architectural decisions, keep them in that context's `docs/adr/` directory.

## Repository structure

This repo is an Nx monorepo. The active projects are:

- `apps/maestro-electron/` for the Electron main process, IPC, and backend services
- `apps/maestro-renderer/` for the Angular renderer UI
- `apps/maestro-renderer-e2e/` for Playwright end-to-end tests
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
