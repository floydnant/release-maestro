# Security

GitHub runs CodeQL, secret scanning, and push protection. Dependabot updates npm, Cargo, and
GitHub Actions dependencies. The pnpm policy restricts provenance, release age, sources, and install scripts.

## Commands

After `make install`:

```bash
make security              # Scan npm and Cargo lockfiles
make sbom                  # Generate source SBOMs
make sbom-release          # Also scan an existing package in dist/executables
make sbom-release ARTIFACT_DIR=dist/packages # Use another package directory
make security-policy-check # Validate exceptions offline
make security-tools        # Download scanners only
```

Commands download pinned, SHA-256-verified tools from `tools/security/tools.json` on first use.
Tools support macOS, Linux, and Windows on x64 and arm64. Delete `.cache/security-tools` to
replace a corrupt cache. The `update-dependencies` skill covers scanner versions, all platform
assets and checksums, advisory rescans, and removal of resolved exceptions. Exception extensions
remain explicit maintainer decisions.

## Vulnerability gate

The required `Dependency vulnerabilities` PR check compares the base and proposed lockfiles with
OSV's pinned reusable PR workflow. Both scans run in the same workflow against current advisories.
Only newly introduced vulnerabilities fail the comparison, including unscored advisories. Existing
findings and newly disclosed advisories affecting both revisions do not block unrelated PRs. The
check also validates exception structure. Scanner and comparison errors fail the required check.
The [Dependency security ruleset](https://github.com/floydnant/release-maestro/rules/24417605)
continues to require that check name. PR comparison reports are uploaded as OSV Actions artifacts
and to GitHub code scanning. The comparison uses an empty OSV config so neither revision can
silently suppress findings. New vulnerabilities must be fixed before merging; local exceptions
apply to full scans rather than the PR comparison.

Release-please PRs, identified by the `release-please--` branch prefix, also run `make security` inside
the required `Dependency vulnerabilities` check. It scans the proposed merge commit with the
same full-scan policy used before publication, including exact, unexpired exceptions.
Unaccepted findings fail that check before the release PR can merge. Reports are uploaded as
`release-pr-vulnerabilities`, including on failure. Ordinary PRs retain the comparison-only policy.
Keep the prefix in `.github/workflows/security.yml` aligned if release-please's branch naming changes.

`make security` scans the complete npm and Cargo lockfiles. The `Full dependency vulnerabilities`
job runs on main, daily, and on demand. Full scans fail on security advisories unless an exact,
unexpired exception applies. Unscored RustSec maintenance notices are informational; unsoundness
blocks. Scanner errors, missing ecosystem coverage, and malformed exceptions also fail.
Reports are `dist/security/{osv,findings}.json`; CI uploads them even on failure.

Dependabot security updates are enabled for this repository and open fix PRs automatically when
GitHub detects an alert with a resolvable patch. On main, daily, and manual main runs, the workflow
submits the complete npm and Cargo dependency snapshot to GitHub. PR runs only generate artifacts
and have no dependency-submission write permission. This supplies the transitive dependencies missing from
GitHub's current graph. Submitted dependencies
receive [Dependabot alerts and security updates](https://docs.github.com/en/rest/dependency-graph/dependency-submission). `.github/dependabot.yml` groups security updates
for npm, Cargo, and GitHub Actions. Security updates are triggered by alerts rather than the
weekly version-update schedule or the daily OSV scan. Dependabot cannot fix every OSV finding, exact
upstream pin, or advisory without a patch. [Automated remediation](#automated-remediation) retries
the remaining npm findings; other findings need maintainer follow-up. Fix PRs run normal CI and are
reviewed before merging. GitHub's documented pnpm support currently ends at v10; this repository
uses v12. Recent Dependabot PRs have updated the lockfile successfully, but that does not establish
complete remediation coverage. Dependency submission fills graph coverage; it cannot guarantee that
Dependabot can resolve a compatible fix.

`tools/security/exceptions.json` accepts 2 existing findings until November 2, 2026.
Exceptions require ecosystem, package, exact version, advisory ID, reason, and UTC expiry date.
They expire at the start of that date. Full scans then block only if the matching vulnerability
is still present; a stale entry for a resolved finding does not fail the scan. Offline policy validation
checks date formats rather than whether the date has passed. Keep exceptions within
30 days, review extensions in a PR, and remove them after fixes. Never regenerate the baseline
automatically or suppress whole packages. Acceptance does not establish safety.

Nx pins Axios, brace-expansion, smol-toml, follow-redirects, and Undici to vulnerable versions.
Angular's build package pins Vite to an affected version. Exact-version overrides in
`pnpm-workspace.yaml` select Axios 1.20.0, brace-expansion 5.0.12, smol-toml 1.9.1,
follow-redirects 1.16.1, Undici 7.30.1, and Vite 8.3.4. Remove an override when upstream uses a
fixed version. Automated remediation PRs can add further scoped overrides; each PR body names
the packages it overrides.

Release-please checks main before creating a release. The Release workflow checks the immutable
tag commit before building or publishing installers, including manual publications and retries.
Both use `make security`; see [releasing](releasing.md).

`make security` runs separately from `make sure` because advisories require network access and
can change without code changes.

## Automated remediation

The Security remediation workflow runs daily on main and supports manual main runs. It retries npm
findings that Dependabot cannot fix, including accepted findings. Cargo findings remain in the report
for maintainer follow-up. Dependabot continues to handle normal version and security updates.

```bash
make security-remediation-plan # Scan and preview eligible fixes without changing dependency inputs
make security-remediate        # Apply and verify fixes; dependency inputs must be committed
```

Run the apply command in a disposable checkout. It changes `pnpm-lock.yaml` and can add scoped
exact-version overrides to `pnpm-workspace.yaml`. It does not commit or publish local changes.
Both commands write `dist/security/remediation.json` and `remediation-pr.md`.

The planner selects stable, non-deprecated registry releases with known publish times that satisfy
`minimumReleaseAge`. It queries OSV to reject candidates with known vulnerabilities. The apply
command first tries a targeted update across transitive dependencies. If the update resolves a
version the planner did not select, or upstream constraints retain a finding, it retries from the
original inputs with an override for each affected version. pnpm enforces the existing freshness,
provenance, and source policy. Install scripts never run. A full scan must remove all targeted
advisories without introducing other findings. Every failed attempt restores its dependency inputs.
A candidate that the rescan, pnpm policy, or the repository policy check rejects gives way to the
next eligible version. A network error or a scanner failure marks the package as failed instead,
because it says nothing about the candidate. A failed run restores the inputs it started from,
including when it cannot write its reports.
Each run clears earlier remediation and scan reports before preflight. A failed apply run removes
reports that describe discarded changes. Scanner failures include the command's stdout and stderr in their
diagnostics when no valid findings report was written.
Reports name the versions actually resolved. Findings without an eligible fix, including findings on
installed prereleases, remain visible; the automation never extends exceptions.

CI reads open Dependabot PR lockfiles without executing their code. Only heads that contain the
scanned main revision can cover findings. It defers packages already covered by a PR only when none
of their proposed versions have known OSV vulnerabilities. Missing fixes and failures appear in the
run summary and uploaded artifacts. Daily runs retry after releases age.

After verification, the workflow creates a Release Maestro CI App token using `RELEASE_APP_CLIENT_ID`
and `RELEASE_APP_PRIVATE_KEY`, the same credentials as release-please. The token grants contents and
pull request writes. It pushes and opens a ready-for-review `deps:` PR on
`security/automated-remediation`, so normal CI runs. Merging remains a maintainer decision,
especially for overrides across major versions.

Each run rebuilds fixes from the scanned main revision. Identical retries do not push new commits.
Changed inputs or a changed base update the same PR with an explicit branch lease. A changed main
revision during preparation stops publication. So do unexpected commits anywhere on the automation
branch and a same-repository PR owned by another actor; fork PRs never count as the automation PR.
Commit authors, committers, subjects, and changed paths identify expected automation commits; this
check is not a cryptographic proof of authorship. Do not hand-edit the reserved branch. To resume,
resolve the human changes and delete the branch. A completed run without verified fixes closes the
existing PR, including when every package is unresolved or covered by Dependabot. This prevents an
old PR from retaining a verification claim after its candidate becomes vulnerable. A run with a
failed package keeps the existing PR and branch unchanged. A transient failure therefore cannot
discard a previous verified fix. A later successful run can create a new PR.

## SBOMs

Syft writes CycloneDX 1.6 JSON to `dist/security`:

| File                   | Contents                                                                    |
| ---------------------- | --------------------------------------------------------------------------- |
| `repository.cdx.json`  | All lockfile dependencies, tagged as runtime or development                 |
| `runtime.cdx.json`     | Production dependency graph, including Electron                             |
| `artifact.cdx.json`    | Packages identifiable in the directory passed to `sbom-release`             |
| `provenance.json`      | Git revision, platform, architecture, and input checksums                   |
| `github-snapshot.json` | GitHub dependency snapshot with direct dependencies, scope, and graph edges |

Source SBOMs use manifests and lockfiles only. Runtime scope also includes renderer translation
packages currently in `devDependencies`. Optional and platform-specific dependencies may not ship.

Keep source and artifact SBOMs together. Filesystem scans miss dependencies bundled in JavaScript,
ASAR, or Rust binaries. Electron's upstream Chromium/Node inventory and embedded native libraries
need separate coverage. License metadata may be incomplete; there is no license allowlist.

CI uploads source SBOMs and the full set after Linux, macOS, and Windows packaging.
Future release publishing should attach the same files.

Electron hardening is tracked in [MAE-167](https://linear.app/floyd-haremsa/issue/MAE-167/harden-electron-renderer-isolation-and-ipc-access).
