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
weekly version-update schedule or the daily OSV scan. Dependabot cannot fix every OSV finding,
exact upstream pin, or advisory without a patch. Remaining findings need maintainer follow-up;
fix PRs run normal CI and are reviewed before merging. GitHub's documented pnpm support currently
ends at v10; this repository uses v12. Recent Dependabot PRs have updated the lockfile successfully,
but that does not establish complete remediation coverage. Dependency submission fills graph
coverage; it cannot guarantee that Dependabot can resolve a compatible fix.

`tools/security/exceptions.json` accepts 9 existing findings until November 2, 2026.
Exceptions require ecosystem, package, exact version, advisory ID, reason, and UTC expiry date.
They expire at the start of that date. Full scans then block only if the matching vulnerability
is still present; a stale entry for a resolved finding does not fail the scan. Offline policy validation
checks date formats rather than whether the date has passed. Keep exceptions within
30 days, review extensions in a PR, and remove them after fixes. Never regenerate the baseline
automatically or suppress whole packages. Acceptance does not establish safety.

Nx pins Axios and brace-expansion to vulnerable versions. Exact-version overrides in
`pnpm-workspace.yaml` replace them with Axios 1.20.0 and brace-expansion 5.0.12. Remove the
overrides when the installed Nx versions use fixed dependencies.

`make security` runs separately from `make sure` because advisories require network access and
can change without code changes.

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
