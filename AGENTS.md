# Release Maestro

Nx monorepo: Electron main process, Angular renderer, a Rust metadata-engine sidecar, and a shared
core lib. See [README.md](README.md) for the stack and project layout.

## What to read

Load guidance for the task at hand; do not load every document by default.

| Work                                | Read                                                                                         |
| ----------------------------------- | -------------------------------------------------------------------------------------------- |
| Product behavior or domain language | [CONTEXT-MAP.md](CONTEXT-MAP.md), then the relevant context glossary                         |
| Architectural behavior              | [ADR index](docs/adr/README.md), then only relevant ADRs                                     |
| Tests or verification               | [docs/testing.md](docs/testing.md) and the verification skill                                |
| Renderer TypeScript or templates    | `angular-patterns`; add `frontend-design` for user-facing UI                                 |
| Async pipelines in either process   | `rxjs-streams`                                                                               |
| Linear issues or PRDs               | [docs/agents/issue-tracker.md](docs/agents/issue-tracker.md) and the relevant workflow skill |

[docs/agents/domain.md](docs/agents/domain.md) explains the context layout and repository-specific
overrides for generic skills.

An ADR is a standing constraint. When a required change conflicts with one, stop and report the
specific ADR and conflict; do not implement the change until it is resolved.

## Issue tracker

Issues and PRDs live in **Linear**, not GitHub Issues — `#123` in a commit subject is a pull
request; Linear issues are `MAE-123`.
See [docs/agents/issue-tracker.md](docs/agents/issue-tracker.md) for the workflow and
the `/triage` skill for the states and labels.

## Verification

ALWAYS verify after changing code, starting with the narrowest relevant check.
The `Makefile` is authoritative for repo-wide commands; `npx nx show project <project> --web false`
is authoritative for the effective targets of one project. Command examples in docs and skills are
intentional convenience summaries.

- **`make` for repo-wide checks** — `make sure`, `make affected`, `make test`, `make lint`,
  `make format-check`, `make build-prod`, `db-*`, packaging.
- **`nx` for single-project checks** — `npx nx test maestro-renderer`, `npx nx build maestro-core`.
  Prefer it over a make wrapper for focused work.
- `make sure` formats, lints, builds, unit-tests, and runs renderer E2E. It mutates formatting.
  Full Electron E2E is intentionally separate (`make e2e`) because it repeatedly opens the app;
  run it when the changed user journey warrants the disruption.
- `make affected` runs build, lint, unit tests, and both E2E targets for affected projects. It does
  not check or mutate formatting.
- Never use `npm run` scripts.

Details in [.agents/skills/verification-loop/SKILL.md](.agents/skills/verification-loop/SKILL.md).

## Code patterns

- [frontend-design](.agents/skills/frontend-design/SKILL.md) — how the UI looks. Required for any
  user-facing change in `apps/maestro-renderer`: design-system tokens and Tailwind first,
  accessibility built in, no bespoke visual direction. Never hand-edit a `*.generated.*` file; design
  tokens are generated from three source JSON files. Class lists are written
  `descriptor | utilities` — a semantic name for the element, then the styling.
- [angular-patterns](.agents/skills/angular-patterns/SKILL.md) — how renderer code is built. Signals
  hold state; bridge into a pipeline with `toSignal`/`toObservable`, never by subscribing to `set()` a
  signal. Extract a component once a template block owns its own state.
- [rxjs-streams](.agents/skills/rxjs-streams/SKILL.md) — asynchronous pipelines in **both** processes.
  A stream is for work where time matters; plain `async`/`await` for one-shots. The flattening
  operator is a behavioral choice — `exhaustMap` and `concatMap` are load-bearing here, see ADR 0001.

## Rules

- Migrations always take a name: `make db-generate NAME=cool-migration`
- Commit messages use Conventional Commits with a mandatory `type:` prefix on the subject line
- Tests: prefer shared fixture files for reusable fixtures; keep fixtures inline only when clearly
  one-off to that spec

## Keeping the docs true

These documents are only worth loading if they still describe the repository. Update them as part of
the change that invalidates them, not afterwards.

- **A domain concept the glossary doesn't have** — add it to the relevant
  `docs/contexts/*/CONTEXT.md` in the same change that introduces it. A term you had to invent to
  name your work is exactly what the glossary is for. Renaming or retiring a concept means editing
  the existing entry, including its _Avoid_ list.
- **A decision that is hard to reverse, surprising without context, and the result of a real
  trade-off** — offer an ADR ([docs/adr/README.md](docs/adr/README.md)). All three must hold; most
  decisions fail at least one and need no ADR.
- **A changed command, target, or verification story** — the `Makefile` is the source of truth, but
  the summaries in this file, [README.md](README.md), [docs/testing.md](docs/testing.md), and
  `verification-loop` restate it. Grep for the old command name and fix every copy.
- **A new or moved code path cited by a skill** — skills name concrete files as worked examples. If
  you move or delete one, update the skill that points at it.

## Skills

`.agents/skills/` holds vendored skills tracked in `skills-lock.json` plus repo-owned ones that are
not in the lock and must survive a re-sync.

Vendored skills are generic. Apply this repository's rules when they mention a different task runner,
context layout, or tool name. In particular, prototype commands go through Make/Nx rather than a new
`package.json` script, and references to an “Agent tool” mean the available parallel delegation
capability; if none exists, do the work locally.
