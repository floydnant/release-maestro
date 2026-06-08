---
name: verification-loop
description: Verification loop using repository make targets.
---

# Verification Loop

## Preferred order

1. Run the narrowest relevant check for the files you changed.
2. If the change spans a project boundary, run that project's test target next.
3. Only widen to repo-level checks when the narrower command passes or does not exist.

## Commands

- Prefer `make ...` targets over raw `npm run ...` commands
- `make sure` (runs `make format`, then lint, test, and build; this mutates formatting)
- `make format-check` (non-mutating formatting check for review/CI-style verification)
- `make e2e` (for web E2E flows when relevant)
- `make build-prod` (to catch production-only build issues)
- `nx test|lint|build` with specific projects for targeted checks
- If a command fails, keep the retry scoped to the touched slice before broadening the check.
- Treat warnings from these checks as actionable feedback, fix new warnings in touched files when feasible, and explicitly call out any remaining warnings that are out of scope or pre-existing
