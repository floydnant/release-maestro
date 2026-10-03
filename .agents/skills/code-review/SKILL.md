---
name: code-review
description: Review a branch, PR, or working-tree diff for regressions, repository standards, spec, and the quality of changed agent guidance. Use for code review or "review this".
---

# Code review

Review committed and uncommitted changes on three independent axes:

- **Regression.** Does existing behavior still work, and is the changed logic correct?
- **Standards.** Does the code follow this repo's documented standards?
- **Spec.** Does the change implement the originating issue or stated scope?

Run the axes in parallel sub-agents. The parent owns verification evidence, missing checks, and the
final judgement. Leave fixes for a separate request.

When the diff changes agent guidance, review the instructions themselves. For each consequential rule,
trace a realistic agent task through its trigger, action, and stopping condition. Check whether the
rule conflicts with other guidance, makes the agent skip needed work, or makes it do work the user
did not ask for. Lead the review with consequential guidance findings. Passing checks and a match
with the PR description do not establish that the guidance makes good decisions.

## Process

### 1. Pin the fixed point and scope

Use the user's fixed point when supplied. For a PR, use that PR's base branch, including the parent
branch of a stacked PR. Otherwise use `origin/main`. Resolve the chosen ref before calculating the
merge base, and state which ref you used. If it is unavailable, ask for a fixed point.

```sh
BASE=$(git merge-base <fixed-point> HEAD)
git diff "$BASE"            # committed, staged, and unstaged work
git diff "$BASE"...HEAD     # committed work only
git diff HEAD               # uncommitted work, for attribution
git log "$BASE"..HEAD --oneline
git status --short
```

Honor an explicit committed-only scope. Inspect relevant untracked files separately because Git
diffs omit them. Documentation and skills belong in the corpus when changed. Stop if the ref is
invalid or the scoped change is empty. Pass the resolved base SHA, exact diff commands, commit list,
and relevant untracked paths to each sub-agent. Require committed or uncommitted attribution for
findings.

### 2. Establish verification evidence

Reuse verification before running checks:

- PR CI is authoritative for its current head SHA. It does not cover additional local changes.
- Session results apply to the files and state they checked. If relevant files changed afterward,
  cite the result as earlier evidence and say what it no longer covers.
- A clear relevant pass or failure needs no rerun. Report failures and continue static review.
- Pending, skipped, cancelled, stale, or inaccessible results leave coverage unknown.

For missing coverage, run the narrowest non-mutating check when its result could change the review
and the check is practical. Follow `.agents/skills/verification-loop/SKILL.md` and `docs/testing.md`.
Use Make for repo-wide checks, Nx for focused project checks, and `make format-check` for formatting.
Run needed checks while sub-agents work. Record each result's source and scope; report checks that
cannot run as gaps. Do not turn a possibly stale result into a current pass. Passing checks do not
prove correctness.

### 3. Identify the spec source

Issues and PRDs live in Linear. `MAE-123` names an issue; `#123` in a commit subject names a PR.
Read a supplied PR's body to establish its claimed scope. An issue in its `Closes` line is meant to
be implemented in full. Issues merely referenced elsewhere in the description are background.

Find the authoritative spec in this order:

1. The closing Linear issue, or originating issue identified by the user, branch, or commits.
   Fetch its description and comments through `docs/agents/issue-tracker.md`.
2. A spec path supplied by the user.
3. A matching PRD or spec under `docs/` or `.scratch/`.
4. The scope stated by the user or in the PR description.

Honor an explicit user scope. If no authoritative spec or stated scope is available, skip the Spec
sub-agent and report `Spec unavailable`. Treat unavailable ticket access as a gap, not a spec pass.

### 4. Identify the standards sources

Pass the sub-agent the files that actually exist here:

- `AGENTS.md`: rules, validation loop, issue tracker.
- `docs/agents/domain.md`: repository-specific context layout, vocabulary, and naming overrides.
- `CONTEXT-MAP.md` and the relevant `docs/contexts/*/CONTEXT.md`: vocabulary and boundaries.
- `docs/adr/`: architectural decisions are standards.
- `docs/testing.md`: test-layer split, E2E conventions, fixture isolation.
- `.agents/skills/frontend-design/SKILL.md`: required for any diff touching
  `apps/maestro-renderer` UI.
- `.agents/skills/angular-patterns/SKILL.md`: signals as the state model, the signal/observable
  bridge, componentization; required for any renderer TypeScript or template diff.
- `.agents/skills/rxjs-streams/SKILL.md`: required for any diff touching an observable in **either**
  process: operator choice, cancellation, subscription lifetime.
- `.agents/skills/verification-loop/SKILL.md`: how changes are meant to be verified.
- `eslint.config.*`, `tsconfig*.json`, `.prettierrc*`: machine-enforced; note them but don't
  repeat checks covered by the verification evidence.

**Engineering principles.** The `principle-*` skills are standards too. Each names a property the
code should have, so pass the ones the diff actually reaches rather than all seven:

Principles: Include when the diff...

- `.agents/skills/principle-type-system-discipline/SKILL.md`: adds or changes a type, a signature, a cast, or a parse of external data
- `.agents/skills/principle-boundary-discipline/SKILL.md`: adds validation, error handling, or a framework adapter
- `.agents/skills/principle-laziness-protocol/SKILL.md`: adds abstraction, layering, or signal threading, or is simply large
- `.agents/skills/principle-foundational-thinking/SKILL.md`: changes a core data structure, or shares state between actors
- `.agents/skills/principle-make-operations-idempotent/SKILL.md`: touches a command, a lifecycle step, or a processing loop
- `.agents/skills/principle-redesign-from-first-principles/SKILL.md`: bolts a new requirement onto an existing design
- `.agents/skills/principle-exhaust-the-design-space/SKILL.md`: introduces a novel interaction or architecture with no precedent here

Cite a principle finding as a judgement call unless it breaks a concrete repository contract.
Judge the resulting code, not whether an invisible design exercise happened.

When the diff touches documentation, Standards must also check that those docs stay true to the code
and workflows, per `AGENTS.md` ("Keeping the docs true"). If code changes warrant a doc update but the
diff doesn't include it, report that as a Standards finding too, for example if a new concept is
introduced in the code but not documented.

For changed agent guidance, also read `.agents/skills/writing-for-agents/SKILL.md` and the guidance
that the changed instructions invoke. Test the directions against realistic tasks. Check whether an
agent can tell when to invoke the guidance, what to do, and when to stop. Review the advice for
conflicts and unnecessary work, even if it matches the current repository and the PR description.

Inspect added files and changed lines for accidentally included secrets, local data, logs, or build artifacts, allowing intentional generated files.

#### Code-smell baseline

Use these Fowler code smells as heuristics alongside the documented standards. Repository standards
win when they endorse a pattern. Label smells as judgement calls, cite the hunk, and explain a
concrete maintenance cost. Skip anything tooling enforces. Suggest extraction only when the shared
logic has the same meaning and an abstraction would reduce complexity.

- **Mysterious Name.** A name hides what a value holds or what a function does. Choose a precise name.
- **Duplicated Code.** The same logic appears in multiple places. Share it when it represents one rule.
- **Feature Envy.** A method repeatedly reaches into another object's data. Consider moving the behavior.
- **Data Clumps.** The same fields or parameters repeatedly travel together. Consider one meaningful type.
- **Primitive Obsession.** A plain value allows confusion between domain concepts. Add a type where it prevents a real bug.
- **Repeated Switches.** Multiple branches repeat the same decision. Consider one shared mapping or an appropriate variant model.
- **Shotgun Surgery.** One logical change requires scattered edits. Consider gathering the owning behavior.
- **Divergent Change.** One module changes for unrelated reasons. Consider separating those responsibilities.
- **Speculative Generality.** New options or abstractions have no current requirement. Remove the unused flexibility.
- **Message Chains.** Callers depend on a long navigation through other objects. Consider an operation that hides that dependency.
- **Middle Man.** A function or class adds only delegation. Remove it when it protects no useful contract.
- **Refused Bequest.** An implementation rejects most of its inherited contract. Consider composition or a narrower contract.

### 5. Run the review axes

Use parallel general-purpose sub-agents when available. Otherwise run the axes sequentially with
separate working notes. Each receives the corpus from step 1 and the writing rules in
`.github/pull_request_template.md`. Ask for short sentences, active voice, and one name per concept.
Number findings `R1`, `S1`, or `P1`. Each needs a short title, a code or requirement reference, and
the concrete effect. Write `None.` when an axis has no findings.

**Regression brief.** Follow `.agents/skills/regression/SKILL.md`. Inspect read-only; the parent owns
verification evidence and checks. Report behavioral regressions, correctness defects, unrelated
changes, useful intentional-change context, and unproven risks. Require a reachable failing input
or sequence for each defect. Trace affected consumers as needed. Load
`.agents/skills/blast-radius/SKILL.md` only when there is a credible risk of consequential downstream
breakage. Crossing a boundary alone does not require the skill; skip it for low-risk changes.
Use the separate subsections defined by the regression skill. Keep the report under 500 words.

If observables, subscriptions, or flattening operators changed, call that out in the Regression
brief. Operator choice and subscription lifetime affect behavior as well as standards.

**Standards brief.** Read the applicable sources from step 4 and the diff. Cite each violated
standard by file and rule. Distinguish hard violations from judgement calls. Include the code-smell
baseline in the brief or give its exact path and section. Require a hunk and concrete maintenance
cost for a smell. Skip tooling-enforced issues. Check changed documentation against the current
code and commands, and report missing updates required by `AGENTS.md`. For changed agent guidance,
assess the instructions as directions an agent will follow, as described in step 4. Number findings
`S1`, `S2`, and so on. Keep the report under 400 words.

**Spec brief.** Read the authoritative spec and scope from step 3, then the diff. Report missing or
partial requirements, scope creep, and incorrect implementations. Quote the requirement or scope
statement for each finding. Number findings `P1`, `P2`, and so on. Keep the report under 400 words.

### 6. Aggregate

For consequential safety claims left unproven, follow `.agents/skills/blast-radius/SKILL.md`.
First reuse relevant session or CI evidence from step 2. Run the smallest decisive check only when
that claim lacks a clear result and the check is practical. Keep temporary probes out of the
committed tree. State what the evidence proves and what remains unknown.

Synthesize the sub-agents' findings. Remove duplicates, resolve disagreements with evidence, and
prioritize by impact. Preserve each finding's source axis so the reader can trace its reasoning.
When agent guidance is the main subject, lead with `## Agent guidance` and the consequences for
agent behavior. Put distinct regression, standards, and spec findings after it, and omit empty axes.
Do not repeat a guidance finding in another section merely to fill an axis.

Under `## Regression`, preserve separate `### Regressions found` and `### Correctness findings`
subsections. Keep useful deliberate-change context in `### Seems intentional`, unrelated findings
in `### Bundled / unrelated changes`, and unresolved risks in `### Unproven risks`.
Intentional changes and unproven risks do not count as findings.

When code is the main subject, write `None.` for empty finding subsections or axes. Omit empty context and risk
subsections. If the guidance review and all three axes have no findings, context, or risks, write
`No findings.` Write `Spec unavailable` when skipped.

Report verification after the findings unless a failed check prevents a trustworthy review. Name
the source and scope of each relevant result. State when evidence predates changed files or CI does
not cover local edits. Do not rerun checks solely to replace a clear CI result. Include finding
counts per axis when they help the reader; skip zero counts in a clean report.
