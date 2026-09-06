---
name: update-dependencies
description: Update Release Maestro dependencies, repair update-related incompatibilities and regressions, and open a PR.
disable-model-invocation: true
---

# Update dependencies

Produce a dependency-update PR that preserves the app's behavior. Updating version numbers is only
the start. Complete the required migrations and fix regressions caused by the updates before handoff.

## Establish scope and baseline

Honor requested packages, versions, and exclusions. With no narrower scope, inspect every tracked
package manifest and lockfile, including the root npm package, `tools/`, and the Rust metadata engine.
Target current stable releases, including majors. Keep prereleases opt-in and preserve existing
version-pinning conventions. A compatible release set may require deferring an individual latest
version.

Inspect repository guidance, git status, the remote default branch, and existing dependency-update
PRs. Record the base commit. Use a dedicated branch or isolated worktree so unrelated local work stays
out of the PR. Reuse a matching branch and PR when continuing this task; leave other authors' work
alone. Default to one PR for the requested refresh, applying related dependency groups in separate
steps so failures can be attributed.

Read [verification-loop](../verification-loop/SKILL.md) and `docs/testing.md`. Establish the relevant
baseline before updating. For a repository-wide refresh, use `make sure` in the isolated worktree.
Record existing failures and keep any formatting-only baseline changes out of the update. If a
failure appears later, compare the same check against the recorded base with its original lockfiles
and equivalent environment before calling it pre-existing.

## Select and apply updates

Use package registries to discover versions and official release notes, compatibility tables, and
migration guides to choose targets. Check peer dependencies, runtime requirements, and supported
toolchains. Record direct dependency versions before and after, migration sources, and reasons for
any deferrals. Discover major updates beyond the currently declared version ranges.

Update coupled packages together. In this repository, pay particular attention to Angular, Nx and
their plugins, TypeScript, the test toolchain, and Electron with native modules such as
`better-sqlite3`. Include `tools/` dependencies and Cargo dependencies when they are in scope.

Use the ecosystem's supported migration tooling where available, following its current official
instructions. Inspect generated changes. Regenerate lockfiles with their owning package manager and
verify installation from the committed locks. Keep peer and engine checks enabled; resolve the
compatibility requirements instead of using forced installs or bypass flags. Inspect lockfile churn
for unrelated changes.

## Repair failures

After each dependency group, run the narrowest relevant checks. Follow a failure through its cause,
apply the migration or compatibility fix, and rerun the failing check. Use
[diagnosing-bugs](../diagnosing-bugs/SKILL.md) for difficult failures. Load the repository's code and
domain guidance for each area you change, including relevant ADRs before architectural changes.

Fix source code, configuration, build tooling, and tests when the update requires it. Preserve the
existing product contract. For a behavior regression, add or adapt a test that exposes the failure
under the updated dependencies and passes with the fix. Change assertions or snapshots only when
the new expectation is justified by the intended behavior. Keep checks, coverage, and type safety
intact; a green suite obtained by disabling them does not complete the update.

Keep repairs attributable to the update. Separate pre-existing failures and unrelated improvements
from this PR. If a migration conflicts with an ADR, stop that migration and report the specific
conflict for resolution, as required by `AGENTS.md`.

When a target cannot be made compatible without an unresolved product or architecture decision,
retain the working version for that dependency group and explain the blocker. Continue independent
updates. When repeated attempts produce no new evidence, record the attempted fixes and the missing
decision or external dependency instead of repeating the same approach. Explicitly requested
versions that remain blocked are unfinished work, even if other updates succeed.

## Verify the final change

Follow the verification skill from focused checks to the full `make sure` gate. Also run:

- `make agents-check` when changing the `tools/` package used by the agent checks.
- `make build-prod` for compiler, bundler, or build-tool updates.
- `make e2e-production` for Electron, native modules, sidecar packaging, or changes affecting packaged
  loading and file URLs. This verifies the host OS; use CI for other platforms.

Inspect the final diff after formatting and migrations. Account for every changed manifest,
lockfile, and repair. Remove incidental changes. Verify the final committed contents, including
reproducible installs for each changed ecosystem. Successful unit tests alone do not establish
runtime or packaging compatibility.

## Open the PR and follow CI

When the user requests this workflow through PR creation, commit and push the task branch and open
the PR without another permission round. If the user limits the task to local changes or planning,
honor that limit. Use a Conventional Commit subject such as `chore: update dependencies`.

Read `.github/pull_request_template.md` and follow it. Explain the update scope and behavior preserved,
then list direct dependency version changes, migration fixes, and any deferred updates with reasons.
Link the official migration notes that explain non-obvious repairs. Use an existing Linear issue when
provided; otherwise follow the template's no-issue alternative. Create tracker issues only when
requested. The template leaves routine check lists to CI; report local verification in the final
response and material verification gaps in the PR. For `gh`, write the body to a temporary file and
pass `--body-file`.

Open as ready for review when the change passes the required local gates. Watch CI on the pushed
commit, diagnose update-related failures, and push fixes until the required checks pass. Reruns should
test a fix or a supported transient-failure hypothesis. Reuse the same PR. If checks remain blocked
or the requested migration is incomplete, keep the PR draft and state the exact blocker. If a ready
PR becomes blocked, convert it to draft. Do not merge or enable auto-merge.

Finish with the PR link, the updates and repairs, verification results, and any remaining blockers.
If nothing needs updating, report that without creating an empty PR. If publishing is unavailable,
leave the local branch and prepared PR body ready and report the missing access.
