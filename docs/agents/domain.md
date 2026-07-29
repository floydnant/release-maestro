# Domain Docs

How to consume this repo's domain documentation. The docs themselves are:

- [`CONTEXT-MAP.md`](../../CONTEXT-MAP.md) — the two contexts, what each spans, how they relate.
  Start here; it links to the glossary for each.
- `docs/contexts/*/CONTEXT.md` — one glossary per context.
- [`docs/adr/`](../adr/) — decisions whose reasoning is not visible in the code.
- [`docs/testing.md`](../testing.md) — test layers, E2E conventions, fixtures.
- [`README.md`](../../README.md) — project structure and stack. Per-project `project.json` files are
  the source of truth for project boundaries and targets.

Read the map and the glossary for the context you are working in before exploring the code.

## Use the glossary's vocabulary

When your output names a domain concept, use the term as defined in the relevant `CONTEXT.md`. Don't
drift to synonyms the project explicitly avoids — the glossaries list them.

If the concept you need isn't in the glossary yet, that's a signal — either you're inventing language
the project doesn't use, or there's a real gap to capture.

## Flag ADR conflicts

An ADR is a standing constraint. If your output contradicts one, surface it explicitly rather than
silently overriding it.

## Naming, for skills that expect other conventions

- The root glossary index is **`CONTEXT-MAP.md`**, not `CONTEXT.md`. A skill that tells you to create
  a root `CONTEXT.md` when none exists (`/grill-with-docs`, `/improve-codebase-architecture`) should
  extend `CONTEXT-MAP.md` and the per-context files instead. Do not create a second root glossary.
- Contexts are product boundaries, not Nx projects — each spans several projects. Do not look for a
  per-project `CONTEXT.md` or a per-project `docs/adr/`. See `CONTEXT-MAP.md` for why.
- New glossaries are added lazily, under `docs/contexts/<context>/CONTEXT.md`, only when an area
  develops vocabulary of its own.
