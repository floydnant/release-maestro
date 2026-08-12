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
  `npx nx lint maestro-electron`, `npx nx build maestro-core`. Prefer it for a single project and
  filtered iteration; `docs/testing.md#fast-iteration` has the exact Jest and Playwright forms.
- Never use `npm run` scripts. `package.json` intentionally has almost none.
- The `Makefile` is authoritative for repo-wide commands. Use
  `npx nx show project <project> --web false` to inspect the effective targets of one project,
  including inferred targets.

## Commands

- `make sure` — format, then lint, build, unit-test, and run development Electron and renderer E2E
  across the repo. **Mutates formatting.**
- `make format-check` — non-mutating formatting check, for review and CI-style verification.
- `make affected` — build, lint, unit tests, development Electron E2E, and renderer E2E, scoped to
  what git says changed; does not check or mutate formatting.
- `make e2e-renderer` — renderer-only E2E and part of `make sure`.
- `make e2e` — development Electron E2E and part of `make sure`. The E2E targets type-check
  themselves first.
- `make e2e-production` — package the app for the host OS and run the production-compatible Electron
  suite. Use it for file-URL routing, lazy chunks, packaging-only, and cross-platform behavior.
- `make build-prod` — catches production-only build issues.
- **A project's type gate is its `build`, unless it has no build.** A green unit test is not a type
  check. Non-buildable projects expose `typecheck`; inspect the effective targets with `nx show`.
- See `docs/testing.md` for the test-layer split and E2E isolation conventions.

## Reading the results

- If a command fails, keep the retry scoped to the touched slice before broadening the check.
- Treat warnings as actionable: fix new warnings in files you touched, and explicitly call out any
  remaining warnings that are out of scope or pre-existing.
