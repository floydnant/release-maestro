# Release Maestro

Nx monorepo: Electron main process, Angular renderer, a Rust metadata-engine sidecar, and a shared
core lib. See [README.md](README.md) for the stack and project layout.

## Read before you work

- [CONTEXT-MAP.md](CONTEXT-MAP.md) — the two product contexts and their glossaries. Contexts are
  product boundaries, not Nx projects; each spans several projects.
- [docs/adr/](docs/adr/) — decisions whose reasoning is not visible in the code. An ADR is a standing
  constraint; flag conflicts rather than overriding them. When a required change conflicts with an ADR,
  stop and report the specific ADR file and the conflict to the user; do not implement the change until
  the conflict is resolved.
- [docs/agents/domain.md](docs/agents/domain.md) — how to use the above, including naming overrides
  for skills that expect different conventions.
- [docs/testing.md](docs/testing.md) — test-layer split, E2E conventions, fixture isolation.

## Issue tracker

Issues and PRDs live in **Linear**, not GitHub Issues — `#123` in a commit subject is a pull
request; Linear issues are `MAE-123`.
See [docs/agents/issue-tracker.md](docs/agents/issue-tracker.md) for the workflow and
the `/triage` skill for the states and labels.

## Verification

ALWAYS verify after changing code, starting with the narrowest relevant check.

- **`make` for repo-wide checks** — `make sure`, `make affected`, `make test`, `make lint`,
  `make format-check`, `make build-prod`, `db-*`, packaging.
- **`nx` for single-project checks** — `npx nx test maestro-renderer`, `npx nx build maestro-core`.
  Prefer it over a make wrapper for focused work; nx schedules and caches per project better.
- Never use `npm run` scripts.
- There is no repo-wide typecheck target. `build` is the type gate for app code; the e2e suites
  type-check themselves as a task dependency.

Details in [.agents/skills/verification-loop/SKILL.md](.agents/skills/verification-loop/SKILL.md).

## Code patterns

- [frontend-design](.agents/skills/frontend-design/SKILL.md) — how the UI looks. Required for any
  user-facing change in `apps/maestro-renderer`: design-system tokens and Tailwind first,
  accessibility built in, no bespoke visual direction. Never hand-edit a `*.generated.*` file; design
  tokens are generated from three source JSON files.
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

## Skills

`.agents/skills/` holds vendored skills tracked in `skills-lock.json` plus repo-owned ones that are
**not** in the lock and must survive a re-sync:

- Written here: `angular-patterns`, `e2e-testing`, `frontend-design`, `regression`, `rxjs-streams`,
  `verification-loop`.
- Rewritten from upstream for this repo's Linear tracker, so no longer syncable: `triage`,
  `to-issues`, `to-prd`.
