---
name: regression
description: >-
    Behavioral regression and correctness review of a diff: what used to work and now
    doesn't, what changed that nobody asked to change, and logic defects the tests
    don't catch. Analysis only — it runs no commands. Use when the user asks to check
    for regressions, or as the Regression axis of /review.
---

# Regression Check

Goal: find behavior that worked before the change and doesn't now, plus logic defects in the
changed code. Prefer evidence over speculation — cite the file and the line, and say what breaks.

## 1. Establish scope

- Read `git status`, the current branch, and the merge base with `main` (or the base named in the
  request).
- Inspect `git log --oneline` and `git diff --stat` for the scoped commits, and include uncommitted
  working-tree changes unless the user scoped you to committed work only.
- Note unrelated or bundled changes and flag them separately from the stated feature work.

## 2. Read the contracts the diff touches

Before judging behavior, load what the change is supposed to honor:

- `CONTEXT-MAP.md` and the relevant `docs/contexts/*/CONTEXT.md` for the pillar being changed.
- `docs/adr/` — an ADR is a standing constraint. A diff that quietly reverses one is a regression
  even when every test passes.
- The zod contracts in `libs/maestro-core/src/schemas/` for any data crossing the main/renderer or
  external boundary, such as settings or metadata-engine IPC. A diff that breaks the schema is a regression even when every test passes.
- `.agents/skills/rxjs-streams/SKILL.md` and `.agents/skills/angular-patterns/SKILL.md` when the diff
  touches an observable, a subscription, or renderer state. Operator choice and subscription lifetime
  are behavior, so a violation there is a regression rather than a style note.

## 3. Behavioral regression review

For changed files, check:

- **Bundled diffs** — unrelated changes riding along on the branch. Recommend split or revert unless
  they are explicitly intentional.
- **Removed behavior** — loading states, empty states, error branches, fallbacks, keyboard paths, or
  affordances that existed before and are gone now. Distinguish deletion from intentional product
  change.
- **IPC contract drift** — a channel's payload changed on one side only. Check the `ipcMain.handle`
  in `apps/maestro-electron`, the `ipcRenderer.invoke` caller in `apps/maestro-renderer`, and the
  schema in `libs/maestro-core` agree. Renderer-side `ipcRenderer.on` listeners must be torn down
  when the component or service is destroyed, or handlers stack up and fire repeatedly.
- **Process ownership** — the main process owns the scan lifecycle (`docs/adr/0001`), and scan UI is
  paced independently of scan data (`docs/adr/0002`). Lifecycle decisions migrating into the renderer,
  or UI re-coupling itself to raw scan events, are regressions against a decision.
- **Reactive state and lifecycle** — Angular signals and `effect()`: effects that write signals they
  also read, computed values that no longer recompute because a dependency moved out of the reactive
  graph, stale state after navigation, in-flight async work resolving after teardown, and pending
  user actions dropped when an async operation completes.
- **Stream semantics** — in either process. A changed flattening operator is a changed behavior:
  `mergeMap` where `exhaustMap` belonged permits concurrent triggers (ADR 0001 allows exactly one scan
  app-wide), and `switchMap` where `concatMap` belonged silently drops work that used to complete.
  Also: a `Subject` that no longer completes, a subscription that lost its `takeUntilDestroyed`, a
  `bufferCount`/batching change that breaks ordering, `materialize` removed from a stream that crosses
  IPC so errors no longer survive the hop, and an `AbortSignal` no longer wired to tear down the
  resource a stream owns. See `.agents/skills/rxjs-streams/SKILL.md`.
- **Paradigm drift** — a `.subscribe()` added to `set()` a signal where `toSignal` was the pattern, or
  a `computed` replaced by an `effect` that writes. Both work and both are regressions against
  `.agents/skills/angular-patterns/SKILL.md`.
- **Persistence** — schema changes without a matching migration (`make db-generate NAME=...`), and
  the `feed_*` versus library table boundary. `make db-truncate-library` deliberately preserves
  `feed_*`; a change that blurs the boundary breaks that guarantee.
- **Sidecar behavior** — `apps/metadata-engine` spawn failures, missing binary, and malformed tag
  output must degrade to a visible state, not a silent hang or an unhandled rejection.
- **Context vocabulary leakage** — music-library terms appearing in release-feed code or vice versa.
  The contexts share infrastructure, not a model (`CONTEXT-MAP.md`).
- **UI regressions on changed screens** — hardcoded colors or one-off CSS replacing design tokens,
  removed labels, roles or accessible names, focus handling that stopped working. See
  `.agents/skills/frontend-design/SKILL.md`.

## 4. Correctness review

Automated gates pass on plenty of wrong code. In the changed lines, look for:

- Off-by-one and boundary errors, especially in paged or windowed reads such as the feed's
  `{ index, count }` loads, and in seek/duration arithmetic.
- Error branches that swallow — `catch` blocks that log and continue, leaving the UI claiming
  success. Explicit error state is required; prototype or placeholder data as a fallback for a failed
  request is not acceptable.
- Unhandled promise rejections, and `await` missing on a call whose failure matters.
- Races and ordering assumptions: concurrent scans, a cancel arriving mid-operation, two IPC replies
  interleaving, startup work that assumes the database or settings are already loaded.
- Conditions inverted or narrowed by the diff, and null/undefined paths newly reachable.

Compare against `main` for behavior that existed before the change. Distinguish **regressions** from
**intentional behavior changes** — report both, but only regressions need fixes.

## 5. Manual verification gaps

Say plainly what you could not determine by reading. Anything that needs the app running — real scan
against a real music folder, playback and seeking, an Apple Mail import, window lifecycle — is a gap
to name, not a conclusion to guess at. Note that `make e2e` covers Electron end-to-end flows and
`make e2e-renderer` covers renderer-only ones if the user wants coverage there.

## 6. Output format

```markdown
## Regression check: [branch or scope]

### Regressions found

[Each with file path, what broke, why it broke, and a concrete fix. Write `None.` if clean.]

### Correctness findings

[Logic defects in changed code, with the failing input or sequence. Write `None.` if clean.]

### Intentional behavior changes

[Not bugs — documented so reviewers don't re-flag them. Write `None.` if none.]

### Bundled / unrelated changes

[Changes outside the stated scope. Write `None.` if none.]

### Residual risk

[One short paragraph: what needs the app running, what has no test coverage, what to watch.]
```

Keep findings evidence-based. Do not pad with praise or broad summaries.
