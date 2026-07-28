---
name: review
description: Review the changes since a fixed point (commit, branch, tag, or merge-base) along three axes — Regression (does existing behavior still work, and is the new logic correct?), Standards (does the code follow this repo's documented standards?), and Spec (does the code match what the originating issue/PRD asked for?). Runs the verification gates, then the three reviews in parallel sub-agents, and reports them side by side. Use when the user wants to review a branch, a PR, work-in-progress changes, or asks to "review since X".
---

# Review

Three-axis review of the diff between the working tree and a fixed point:

- **Regression** — does behavior that worked before still work, and is the changed logic correct?
- **Standards** — does the code conform to this repo's documented standards?
- **Spec** — does the code faithfully implement the originating issue / PRD / spec?

All three run as **parallel sub-agents** so they don't pollute each other's context. This skill also
runs the automated verification gates itself and reports them as a fourth section.

## Process

### 1. Pin the fixed point

Whatever the user said is the fixed point — a commit SHA, branch name, tag, `main`, `HEAD~5`. Pass it
through without being opinionated. If they didn't say, default to the merge base with `main` and
state that you did.

### 2. Assemble the review corpus

**Review committed and uncommitted work by default**, unless the user scoped it otherwise:

```sh
BASE=$(git merge-base <fixed-point> HEAD)
git diff $BASE            # everything: committed + staged + unstaged
git diff $BASE...HEAD     # committed only
git diff HEAD             # uncommitted only — use to attribute findings
git log $BASE..HEAD --oneline
git status --short
```

Pass the exact commands to the sub-agents rather than pasting a huge diff into their prompts. Tell
them to attribute each finding to committed or uncommitted work so the user knows what a rebase would
and wouldn't carry.

### 3. Run the verification gates

Review owns the automated checks; the Regression sub-agent does not run them. Follow
`.agents/skills/verification-loop/SKILL.md`: start with the narrowest relevant target for the
projects the diff touches, widen only as needed.

**Use non-mutating targets.** Sub-agents are reading the working tree while these run, and the user
may have uncommitted work in it — so `make format-check`, never `make format` or `make sure`.

| Diff touches                              | Run                                                 |
| ----------------------------------------- | --------------------------------------------------- |
| anything                                  | `make format-check`, `make lint`, `make typecheck`   |
| `apps/maestro-renderer`                   | `make test-renderer`                                 |
| `apps/maestro-electron`                   | `make test-electron`                                 |
| `libs/maestro-core`                       | `make test-core`                                     |
| `apps/metadata-engine`                    | `make test-engine`                                   |
| `apps/maestro-renderer/design-tokens`     | `make design-tokens-check`                           |
| several projects, or unclear              | `make affected`                                      |
| a user journey (scan/import, feed, playback) | `make e2e` or `make e2e-renderer`                 |
| build config, packaging, or deps          | `make build-prod`                                    |

Report pass/fail with the command that produced it. Never claim green without having run it. If a
gate fails, keep going — the sub-agents still produce useful findings — and lead the final report
with the failure.

### 4. Identify the spec source

Issues and PRDs live in **Notion**, not GitHub Issues — `#123`-style refs in this repo's commit
subjects are pull requests. Look for the originating spec in this order:

1. Issue references in the commit messages or branch name — fetch via the workflow in
   `docs/agents/issue-tracker.md`.
2. A path the user passed as an argument.
3. A PRD or spec file under `docs/` or `.scratch/` matching the branch name or feature.
4. If nothing is found, ask the user where the spec is. If they say there isn't one, skip the Spec
   sub-agent and report "no spec available".

### 5. Identify the standards sources

Pass the sub-agent the files that actually exist here:

- `AGENTS.md` — rules, validation loop, issue tracker.
- `CONTEXT-MAP.md` and the relevant `docs/contexts/*/CONTEXT.md` — vocabulary and boundaries.
- `docs/adr/` — architectural decisions are standards.
- `docs/testing.md` — test-layer split, E2E conventions, fixture isolation.
- `.agents/skills/frontend-design/SKILL.md` — required for any diff touching
  `apps/maestro-renderer` UI.
- `.agents/skills/verification-loop/SKILL.md` — how changes are meant to be verified.
- `eslint.config.*`, `tsconfig*.json`, `.prettierrc*` — machine-enforced; note them but don't
  re-check what step 3 already ran.

### 6. Spawn the three sub-agents in parallel

Send a single message with three `Agent` tool calls, all `general-purpose`. Each gets the diff
commands from step 2 and the commit list.

**Regression sub-agent** — brief: "Follow `.agents/skills/regression/SKILL.md`. Do not run any
commands; the verification gates are already being run for you. Report behavioral regressions,
correctness defects in the changed logic, bundled/unrelated changes, and intentional behavior
changes, using that skill's output format. Under 500 words."

**Standards sub-agent** — brief: "Read the standards docs listed. Then read the diff. Report — per
file and hunk where relevant — every place the diff violates a documented standard. Cite the standard
(file plus the rule). Distinguish hard violations from judgement calls. Skip anything tooling
enforces. Under 400 words." Include the step 5 file list.

**Spec sub-agent** — brief: "Read the spec. Then read the diff. Report: (a) requirements the spec
asked for that are missing or partial; (b) behavior in the diff that wasn't asked for (scope creep);
(c) requirements that look implemented but where the implementation looks wrong. Quote the spec line
for each finding. Under 400 words." Include the spec path or fetched contents.

Run the step 3 gates while the sub-agents work.

### 7. Aggregate

Present the results under `## Gates`, `## Regression`, `## Standards`, and `## Spec`. Keep the three
sub-agent reports verbatim or lightly cleaned. Do **not** merge or rerank findings across axes — the
separation is the point.

End with a one-line summary: gate status, total findings per axis, and the worst single issue.

Report findings only. Don't fix anything unless the user asks — a review that edits the code under
review makes the next review meaningless.

## Why separate axes

A change can pass one axis and fail another:

- Green tests and clean standards, but it implements the wrong thing → **Regression and Standards
  pass, Spec fail.**
- Exactly what the issue asked for, but it breaks an ADR or a sibling flow → **Spec passes,
  Regression fails.**
- Correct and well-specified, but written against the project's conventions → **Regression and Spec
  pass, Standards fail.**

Reporting them separately stops one axis from masking another.
