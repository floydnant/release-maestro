---
name: verification-loop
description: Verification loop using repository make targets.
---

# Verification Loop

## Preferred order

1. Run the narrowest relevant check for the files you changed.
2. If the change spans a project boundary, run that project's target next.
3. Only widen to repo-level checks when the narrower command passes or does not exist.

## make or nx

- **`make` for overarching checks** — anything that spans the repo: `make sure`, `make affected`,
  `make test`, `make lint`, `make format-check`, `make build-prod`, and the `db-*` and packaging
  targets. These are the public interface and what CI runs.
- **`nx` for focused, single-project checks** — `npx nx test maestro-renderer`,
  `npx nx lint maestro-electron`, `npx nx build maestro-core`. Going direct is preferred over a make
  wrapper here: nx schedules and caches per project better, and the target name is the same one the
  project config declares.
- Never use `npm run` scripts. `package.json` intentionally has almost none.

## Commands

- `make sure` — format, then lint, build, and test across the repo. **Mutates formatting.**
- `make format-check` — non-mutating formatting check, for review and CI-style verification.
- `make affected` — build, lint, test, and both e2e suites, scoped to what git says changed.
- `make e2e` / `make e2e-renderer` — Electron and renderer-only E2E. Both type-check themselves
  first via `maestro-e2e:typecheck`.
- `make build-prod` — catches production-only build issues.
- **Type errors in app code surface through `build`**, not through a typecheck target. Only
  `maestro-e2e` declares `typecheck`, and its e2e targets depend on it, so `make build` /
  `make sure` / `npx nx build <project>` is the type gate for renderer, electron, and core.
- See `docs/testing.md` for the test-layer split and E2E isolation conventions.

## Reading the results

- If a command fails, keep the retry scoped to the touched slice before broadening the check.
- Treat warnings as actionable: fix new warnings in files you touched, and explicitly call out any
  remaining warnings that are out of scope or pre-existing.
