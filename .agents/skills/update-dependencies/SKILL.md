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
   For a long-running migration, or a breaking major that requires source-code changes, use
   [show-me-your-work](../show-me-your-work/SKILL.md) for the rest of the run. Start its decision log
   before the first migration change and carry it through PR publication. Routine updates and majors
   resolved by manifest and lockfile changes alone do not need a log.
4. Run focused checks after each group and repair update-related failures in code, configuration,
   tooling, and tests. For difficult failures, use [diagnosing-bugs](../diagnosing-bugs/SKILL.md).
   Confirm suspected pre-existing failures against the base with its original locks.
5. Add regression coverage for broken behavior. Preserve checks and type safety; do not force
   incompatible installs or weaken assertions to get green results.
6. If an update needs an unresolved product or architecture decision, retain that group's working
   versions, explain the blocker, and continue independent updates. Follow `AGENTS.md` for ADR
   conflicts. Stop repeating attempts when they produce no new evidence. A blocked explicitly
   requested version remains unfinished work.

## Verify and publish

Follow [verification-loop](../verification-loop/SKILL.md) from focused checks through `make sure`.
Verify installs from the final lockfiles and inspect generated changes for unrelated churn. Also run:

- `make agents-check` for changes to the `tools/` package.
- `make build-prod` for compiler, bundler, or build-tool updates.
- `make e2e-production` for Electron, native modules, sidecar packaging, or packaged loading changes.
  Use CI for other platforms.

If the final diff changes source code, configuration, tooling, or tests, run
[code-review](../code-review/SKILL.md) against the recorded base commit after the local gates pass
and before publishing. Manifest-only and lockfile-only updates do not need this review.

Unless the user limits the task to local work, commit, push, and open one PR following
`.github/pull_request_template.md`. Include direct dependency version changes, migration fixes,
relevant official migration links, and deferred updates with reasons. Report local verification in
the final response; the template leaves routine check lists to CI.

Open ready for review after local gates pass. Watch CI on the pushed commit and fix update-related
failures on the same PR. Keep blocked or incomplete work in draft and explain the blocker. Do not
merge or enable auto-merge.

Return the PR link, repairs, verification results, and blockers. If nothing needs updating, report
that without an empty PR. If publishing is unavailable, leave the branch and PR body ready locally.
