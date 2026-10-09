---
name: update-dependencies
description: Update Release Maestro dependencies and pinned tools, repair regressions, and open a PR.
disable-model-invocation: true
---

# Update dependencies

Deliver a verified dependency-update PR, including migrations and fixes for anything the updates break.
Preserve existing product behavior.

## Update and repair

1. Honor the requested scope. By default, update all tracked npm and Cargo packages, the Node.js
   runtime, GitHub Actions, and pinned tools in `tools/security/tools.json` to compatible stable
   releases, including majors. Read `docs/security.md` when the security tooling is present.
   Use a supported Node.js LTS release. Keep `.node-version`, the engine range, CI setup, and
   developer bootstrap documentation aligned.
   Keep prereleases opt-in and existing pinning conventions.
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

## Security tools and findings

For OSV-Scanner and Syft, check the official releases of each repository named in
`tools/security/tools.json`. Update each tool's version, asset names, and SHA-256 digests together.
Account for every configured platform, including platforms other than the host. Use the upstream
release checksums and compare them with downloaded asset bytes; verify upstream signatures or
attestations when available. Keep the installer compatible with the selected release layout.

Run `make security` against the updated lockfiles. Fix findings within the requested scope and remove
exceptions for findings no longer present. Review dependency overrides and remove them when upstream
versions include the fixes. Keep the exception count and tooling instructions in `docs/security.md`
current. Report remaining blocking findings and expired exceptions with their package versions,
advisory IDs, and available fixes. Risk acceptance and exception extensions require an explicit
maintainer decision; do not regenerate the baseline or extend expiry dates to make the scan pass.

## Verify and publish

Follow [verification-loop](../verification-loop/SKILL.md) from focused checks through `make sure`.
Verify installs from the final lockfiles and inspect generated changes for unrelated churn. Also run:

- `make agents-check` for changes to agent skills, harness tooling, their root dependencies, or files
  under `.agents/`.
- `make test-tools` for changes to repository tools, their dependencies, or files under `tools/`.
- `make security` for dependency updates; a failing scan keeps the PR blocked.
- `make security-tools` and `make sbom` for scanner pin, checksum, installer, or inventory changes.
  Run `make sbom-release` against an existing package when artifact scanning changes. Verify the
  non-host platform assets and use CI to exercise supported operating systems.
- `make build-prod` for compiler, bundler, or build-tool updates.
- `make e2e-production` for Electron, native modules, sidecar packaging, or packaged loading changes.
  Use CI for other platforms.

If the final diff changes source code, configuration, tooling, or tests, run
[code-review](../code-review/SKILL.md) against the recorded base commit after the local gates pass
and before publishing. Manifest-only and lockfile-only updates do not need this review.

Unless the user limits the task to local work, commit, push, and open one PR following
`.github/pull_request_template.md`. Include direct dependency and pinned-tool version changes,
migration fixes, relevant official migration links, and deferred updates with reasons. Report local
verification in the final response; the template leaves routine check lists to CI.

Open ready for review after local gates pass. Watch CI on the pushed commit and fix update-related
failures on the same PR. Keep blocked or incomplete work in draft and explain the blocker. Do not
merge or enable auto-merge.

After the ready-for-review update PR passes CI, inspect each open Dependabot-authored PR. Close it
only when the final update PR contains the same dependency or workflow update at that version or a
newer one. Comment `Superseded by #<update PR number>.` so GitHub links the replacement. Keep
unrelated and deferred updates open. Also keep every Dependabot PR open while the update PR is draft,
blocked, or unpublished.

Return the PR link, repairs, verification results, and blockers. If nothing needs updating, report
that without an empty PR. If publishing is unavailable, leave the branch and PR body ready locally.
