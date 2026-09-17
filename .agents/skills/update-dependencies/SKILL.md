---
name: update-dependencies
description: Update Release Maestro dependencies, repair update-related incompatibilities and regressions, and open a PR.
disable-model-invocation: true
---

# Update dependencies

Deliver a verified dependency-update PR, including migrations and fixes for anything the updates break.
Preserve existing product behavior.

## Update and repair

1. Honor the requested scope. By default, update all tracked npm and Cargo packages to compatible
   stable releases, including majors. Keep prereleases opt-in and existing pinning conventions.
2. Start a dedicated branch or worktree from `origin/main`, record the base commit, and establish a
   verification baseline. Reuse a matching branch and PR when resuming. Keep unrelated changes out.
3. Check registries and official migration guides for versions, peer dependencies, and runtime
   requirements. Update coupled packages together, especially Angular/Nx/TypeScript, the test toolchain,
   and Electron/native modules. Use supported migration tools and regenerate the owning lockfiles.
   Freeze the selected versions after the first coherent lockfiles are generated. Do not refresh
   registries or advance versions again during repair or verification; a later release belongs in the
   next update run.
   For a long-running migration, or a breaking major that requires source-code changes, use
   [show-me-your-work](../show-me-your-work/SKILL.md) for the rest of the run. Start its decision log
   before the first migration change and carry it through PR publication. Routine updates and majors
   resolved by manifest and lockfile changes alone do not need a log.
4. Run the narrowest check that exercises each update-related repair in code, configuration, tooling,
   or tests. Run a given check once after the repair and retry it at most once if the first result gives
   actionable evidence for a fix. Do not broaden merely to gain confidence. For difficult failures,
   use [diagnosing-bugs](../diagnosing-bugs/SKILL.md). Confirm suspected pre-existing failures against
   the base only when a quick focused comparison can decide whether the update caused them.
5. Add regression coverage for broken behavior. Preserve checks and type safety; do not force
   incompatible installs or weaken assertions to get green results.
6. If an update needs an unresolved product or architecture decision, retain that group's working
   versions, explain the blocker, and continue independent updates. Follow `AGENTS.md` for ADR
   conflicts. Stop repeating attempts when they produce no new evidence. A blocked explicitly
   requested version remains unfinished work.

## Verify and publish

For unattended and scheduled dependency updates, CI is the authoritative verification environment.
Keep local work bounded:

- Inspect the final manifests, lockfiles, and generated changes for unrelated churn.
- Run one install or lockfile-generation path per package manager. Do not repeat a clean install after
  it has already reproduced the selected dependency graph.
- Run only focused project checks needed to validate source or configuration repairs.
- Do not run `make sure`, `make affected`, full E2E suites, production builds, or packaging locally.
  Leave those gates to CI, including `make build-prod`, `make e2e-production`, and other platforms.
- Stop a local check that is resource-constrained, unsupported by the host, or not making useful
  progress. Record the limitation in the PR instead of serializing or repeatedly retrying broad gates.
- Do not restart completed verification because a registry published a newer dependency during the
  run. Keep the frozen versions and finish the PR.

If the final diff changes source code, configuration, tooling, or tests, run
[code-review](../code-review/SKILL.md) against the recorded base commit before publishing.
Manifest-only and lockfile-only updates do not need this review.

Unless the user limits the task to local work, commit, push, and open one PR following
`.github/pull_request_template.md`. Include direct dependency version changes, migration fixes,
relevant official migration links, deferred updates with reasons, focused checks actually run, and
the gates intentionally delegated to CI.

Open the PR as draft without waiting for broad local verification. Watch CI on the pushed commit and
fix update-related failures on the same PR. Mark it ready for review only after required CI passes.
Keep blocked or incomplete work in draft and explain the blocker. Do not merge or enable auto-merge.

Return the PR link, repairs, verification results, and blockers. If nothing needs updating, report
that without an empty PR. If publishing is unavailable, leave the branch and PR body ready locally.
