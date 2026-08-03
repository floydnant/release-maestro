# Domain Docs

How to consume this repo's domain documentation. The docs themselves are:

- [`CONTEXT-MAP.md`](../../CONTEXT-MAP.md) — the two contexts, what each spans, how they relate.
  Start here; it links to the glossary for each.
- `docs/contexts/*/CONTEXT.md` — one glossary per context.
- [`docs/adr/`](../adr/) — decisions whose reasoning is not visible in the code.
- [`docs/testing.md`](../testing.md) — test layers, E2E conventions, fixtures.
- [`README.md`](../../README.md) — project structure and stack. Per-project `project.json` files
  declare explicit configuration; use `npx nx show project <project> --web false` for the effective
  target inventory, including inferred targets.

Read the map and the glossary for the context you are working in before exploring the code.

Repository-specific guidance here overrides generic context-file rules in vendored skills.

## Use the glossary's vocabulary

When your output names a domain concept, use the term as defined in the relevant `CONTEXT.md`. Don't
drift to synonyms the project explicitly avoids — the glossaries list them.

If the concept you need isn't in the glossary yet, that's a signal — either you're inventing language
the project doesn't use, or there's a real gap to capture.

The glossaries may include a small implementation anchor — a route, schema field, protocol name, or
representative code location — when it makes the meaning operationally unambiguous or helps an agent
land in the right code. Keep the definition about domain meaning; broader implementation design,
workflows, and inventories belong in code, ADRs, or focused technical documentation.

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
- A generic skill that says `CONTEXT.md` must contain no implementation details should follow the
  limited-anchor rule above instead.
- **Route and page-component names follow the route.** A route is user-facing copy, so `/tracks` is
  served by `TracksComponent` in `pages/tracks/`, even though the glossary says `track` belongs in
  copy and `song` in code. The identifier names a view, not a domain concept; the register split
  applies to the domain, which is why `SongTableComponent` sits one folder away carrying `Song` rows.
  Without this, every page in the library disagrees with its own URL.
- `ADR-FORMAT.md` (bundled with `/grill-with-docs`, also cited by
  `/improve-codebase-architecture`) owns the ADR format and the test for when one is warranted.
  Two things it does not know about this repo: `docs/adr/` already exists, so ignore its instruction
  to create the directory lazily; and a new ADR also needs a row in the index table in
  [`docs/adr/README.md`](../adr/README.md), including its context.
