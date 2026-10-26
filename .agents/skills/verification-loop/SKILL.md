---
name: verification-loop
description: Choose verification depth for a change and its handoff, then run focused Nx or repository Make checks.
---

# Verification loop

## Choose the stopping point

Decide what failure the change could cause, then choose checks for both its risk and its delivery.
Classify the effect, not the file type: an instruction or configuration edit can change behavior.

- **Low risk:** Explanatory prose or isolated presentation with no changed behavior or contract.
  Inspect the diff and use a focused check only where it could catch a real mistake.
- **Scoped behavior:** A change within one project or user flow. Run the smallest relevant test,
  build/type gate, or direct behavior check. Add another check only for a distinct failure mode.
- **Cross-boundary or high-impact behavior:** Shared contracts, persistence, async lifecycle,
  dependencies, build configuration, and packaging can affect other projects or environments.
  Check the affected consumers or integration path. Use production E2E when packaged behavior is
  the risk.

For agent guidance, read the changed rule through representative tasks and handoffs. Run
`make agents-check` for structural errors. Application suites do not test agent decisions.

The handoff determines when that evidence is needed:

- **Ongoing collaboration:** Verify a coherent slice with the smallest useful check. A focused or
  filtered result can be enough for the current turn. State any material untested risk if handing
  work back while it is still in progress.
- **Completed task without a PR:** Run the checks needed to support the completed claim across the
  affected behavior. A local change does not require a repo-wide run merely because it is done.
- **Review-ready PR:** Run focused local checks for likely failures, then use CI on the pushed head
  for broad gates. Follow CI through completion when the task includes delivering the PR. Run a
  broad local gate when CI is unavailable, a relevant risk is outside CI, or a task-specific rule
  requires it.

Reuse a relevant result while the code and inputs it checked remain unchanged. After a later edit,
rerun only the checks it could invalidate. Stop when the selected checks cover the credible risks;
there is no automatic progression from a filtered check to a project suite to `make sure`. Report
what ran and any meaningful gap. A named gate in the task or another workflow still applies.

## make or nx

- **`make` for overarching checks** — anything that spans the repo: `make sure`, `make affected`,
  `make test`, `make lint`, `make format-check`, `make build-prod`, and the `db-*` and packaging
  targets. These are the public interface and what CI runs.
- **`nx` for focused, single-project checks** — `pnpm exec nx test maestro-renderer`,
  `pnpm exec nx lint maestro-electron`, `pnpm exec nx build maestro-core`. Prefer it for a single project and
  filtered iteration; `docs/testing.md#fast-iteration` has the exact Jest and Playwright forms.
- Never use package scripts directly. `package.json` intentionally has almost none.
- The `Makefile` is authoritative for repo-wide commands. Use
  `pnpm exec nx show project <project> --web false` to inspect the effective targets of one project,
  including inferred targets.

## Commands

- `make install` or `make i` — install the root package from the lockfile, fetch locked Rust crates,
  and install Playwright Chromium with its system dependencies. Requires Node, pnpm, and Rust.

- `make sure` — format, then lint, build, unit-test, and run development Electron and renderer E2E
  across the repo. It also runs `make test-tools`. **Mutates formatting.**
- `make test-tools` — repository tools tests. `make test` includes them; `make agents-check` checks
  the agent skills and harness adapters.
- `make format-check` — non-mutating formatting check, for review and CI-style verification.
- `make security` — current npm and Rust vulnerability advisories; requires network access and runs
  separately from `make sure`. `make sbom` generates dependency inventories; `make sbom-release`
  adds an inventory of an existing package. See `docs/security.md` for exception policy and limits.
- `make security-remediation-plan` previews npm fixes and official Node LTS security updates.
  `make security-remediate` applies them in a disposable checkout. The daily Security remediation
  workflow publishes the combined bot PR.
- `make affected` — build, lint, unit tests, development Electron E2E, and renderer E2E, scoped to
  what git says changed; does not check or mutate formatting.
- `make e2e-renderer` — renderer-only E2E and part of `make sure`.
- `make e2e` — development Electron E2E and part of `make sure`. The E2E targets type-check
  themselves first.
- `make e2e-production` — package the app for the host OS and run the production-compatible Electron
  suite. Use it for file-URL routing, lazy chunks, packaging-only, and cross-platform behavior.
- `make dev-instance-self-test` — verify the instance manager by starting two complete development
  stacks in temporary worktrees from committed `HEAD`. Run it after committing changes to
  `tools/dev-instance`; CI runs it separately.
- `make build-prod` — catches production-only build issues.
- **A project's type gate is its `build`, unless it has no build.** A green unit test is not a type
  check. Non-buildable projects expose `typecheck`; inspect them with `pnpm exec nx show project <project>`.
- See `docs/testing.md` for the test-layer split and E2E isolation conventions.

## Reading the results

- If a command fails, keep the retry scoped to the touched slice before broadening the check.
- Treat warnings as actionable: fix new warnings in files you touched, and explicitly call out any
  remaining warnings that are out of scope or pre-existing.
