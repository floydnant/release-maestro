---
name: regression
description: >-
    Regression check for branch or local changes: run verification suites, compare
    behavior against main, and report behavioral regressions tests may miss. Use when
    the user asks to check for regression, run a regression pass, or invokes /regression.
---

# Regression Check

Goal: confirm recent changes did not break existing behavior. Prefer evidence over speculation.

## 1. Establish scope

- Read `git status`, current branch, and merge base with `main` (or the base branch named in the request).
- Inspect `git log --oneline` and `git diff --stat` for the scoped commits or working tree.
- Note unrelated or bundled changes — flag them separately from the stated feature work.

## 2. Run automated gates

Default bundle:

1. `make sure` (format, typecheck, expo compat, unit/integration tests, lint)
2. `make semgrep`

When the diff touches `security/*`, `compliance/masvs/*`, auth, storage, network wrappers, or permissions:

- Also run `make verify-security`.

When the diff touches critical user journeys (navigation, search, checkout, lead capture, favorites, auth):

- Run targeted tests for touched modules under `make test-shared`.
- Consider `make test-e2e` or `make test-e2e-live` when web E2E covers the changed flow; use Maestro flows under `.maestro/` for native-only paths.

Report pass/fail first. Do not claim green without running the commands.

## 3. Behavioral regression review

Automated gates can pass while behavior regresses. For changed files, check:

- **Unrelated diffs** bundled into the branch (revert or split unless explicitly intentional).
- **Removed behavior** (sticky headers, guest paths, fallbacks, loading states) vs intentional product changes.
- **State and lifecycle** — Zustand hydration, TanStack Query error branches, auth/session restore ordering, pending actions applied after async completion.
- **Module boundaries** — inverted imports (e.g. `state/` importing from `components/`), new circular-import risk.
- **i18n and a11y** — removed labels/roles, hardcoded strings, broken touch targets on changed UI.
- **Security surfaces** — new direct `fetch`, storage, or external-link usage bypassing reviewed wrappers.
- **Prototype data fallbacks** reintroduced for failed API/CMS requests (explicit error states are required).

Compare against `main` for behavior that existed before the change. Distinguish **regressions** from **intentional behavior changes** — call out both, but only regressions need fixes.

## 4. Live-data spot check

When upstream APIs are reachable, validate at least one affected flow against live data (not fixtures only). Treat mocked runs as CI/outage fallback.

Native UI: verify on iOS or Android simulator — never use the Metro web target for visual or navigation sign-off.

## 5. Output format

```markdown
## Regression check: [branch or scope]

### Automated checks

- [pass/fail] make verify-shared — [summary]
- [pass/fail] make semgrep — [summary]
- [optional] targeted tests / E2E — [summary]

### Regressions found

[List each with file path, what broke, and concrete fix. Write `None.` if clean.]

### Intentional behavior changes

[Not bugs — document so reviewers do not re-flag. Write `None.` if none.]

### Residual risk / gaps

[One short paragraph: untested paths, needs manual QA, or follow-up tests.]
```

Keep findings evidence-based. Do not pad with praise or broad summaries.
