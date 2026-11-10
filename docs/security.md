# Security

GitHub runs CodeQL, secret scanning, and push protection. Dependabot updates npm, Cargo, and
GitHub Actions dependencies. The pnpm policy restricts provenance, release age, sources, and install scripts.

## Runtime security

The supported Node.js ranges start at 22.23.4 and 24.22.1. These releases include the
[October 21, 2026 security fixes](https://nodejs.org/en/blog/vulnerability/october-2026-security-releases),
including the Brotli decoder vulnerability CVE-2026-111497. `.node-version` pins 24.22.2 for
development and CI. Change the active shell runtime too; the version file does not replace an
already running Node.js installation.

Electron bundles its own runtime. Electron 45.0.0 reports Node 24.22.0, but its
[Node build patch](https://github.com/electron/electron/blob/v45.0.0/patches/node/build_add_gn_build_files.patch)
links Chromium's Brotli decoder. The
[decoder shipped in Chromium 156.0.8078.48](https://github.com/chromium/chromium/blob/156.0.8078.48/third_party/brotli/dec/decode.c)
contains the invalid-block-switch rejection and error propagation in the Brotli 1.2.1 security fix.
Source inspection therefore indicates that Electron 45.0.0 includes the fix for this specific Brotli
vulnerability. This does not establish coverage for every advisory in the Node.js security release.

## Commands

After `make install`:

```bash
make security              # Scan npm and Cargo lockfiles
make security-runtimes     # Inventory bundled browser engines and check upstream freshness
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
remain explicit maintainer decisions, except the patch-bound renewals described below.

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

Release-please PRs, identified by the `release-please--` branch prefix, and PRs that change
`tools/security/exceptions.json` or `patches/` also run `make security` inside
the required `Dependency vulnerabilities` check. It scans the proposed merge commit with the
same full-scan policy used before publication, including exact, unexpired exceptions.
Unaccepted findings fail that check before the PR can merge. Reports are uploaded as
`release-pr-vulnerabilities`, including on failure. Other PRs retain the comparison-only policy.
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

`tools/security/exceptions.json` contains one patch-bound allowance for deepmerge 4.3.1 and
GHSA-gcqx-w48m-w2h4, expiring November 24, 2026 at 00:00 UTC. Floyd Haremsa owns the upstream
replacement and removal, recorded in [MAE-181](https://linear.app/floyd-haremsa/issue/MAE-181).
Exceptions require ecosystem, package, exact version, advisory ID, reason, review date (`reviewed`) and
UTC expiry date. The expiry may be at most 30 days after the review date, and the review date cannot be
in the future. `make security-policy-check` enforces both. Exceptions expire at the start of the
expiry date. Full scans then block only if the matching vulnerability
is still present; a stale entry for a resolved finding does not fail the scan. Remove exceptions after
fixes. Never regenerate the baseline automatically or suppress whole packages. Acceptance does not
establish safety.

Nx and other build tools still pin vulnerable dependency versions. Exact-version overrides in
`pnpm-workspace.yaml` select Axios 1.20.0, brace-expansion 5.0.12, smol-toml 1.9.1,
follow-redirects 1.16.2, Undici 7.30.1, basic-ftp 6.2.1, esbuild 0.25.0,
serialize-javascript 7.1.4, Zod 4.6.6, Glob 14.0.2, and Minimatch 11.0.1.
The Angular build package now uses fixed Vite 8.3.5, so its override was removed.
Minimatch 9 and 10 use exact-version overrides to 11.0.1. Legacy versions 3 and 5 remain
on their upstream ranges because overriding them produced an empty fixture archive.
Remove an override when upstream uses a fixed version.

The full scan reports one accepted finding while the reviewed deepmerge patch allowance remains valid.
Removing bandcamp-fetch also removed extract-zip and both of its findings. The scan reports no minimatch findings.

| Package         | Advisory            | Remediation                                                                                   |
| --------------- | ------------------- | --------------------------------------------------------------------------------------------- |
| deepmerge 4.3.1 | GHSA-gcqx-w48m-w2h4 | Local pnpm patch blocks `__proto__` copying; patch-bound allowance expires November 24, 2026. |

The local `patches/deepmerge@4.3.1.patch` rejects `__proto__` in both target and source
copy loops, in the source and both distributed builds. Regression tests exercise the installed
package through Jest and fork-ts-checker-webpack-plugin dependency resolution. This mitigates the
reported returned-object prototype poisoning. It does not establish packaged/shipped exposure.
The scanner still reports the advisory as accepted until the allowance expires. Before scanning,
the gate verifies the patch SHA-256, workspace registration, lockfile patch hash, and every locked
snapshot for that package version. Missing, changed or unregistered patches fail closed. Frozen
installation and installed-package regression tests verify application and behavior in CI.
The PR comparison still uses no exceptions, so new vulnerabilities remain blocked.

A patch-bound allowance also records `patch.since`, its first acceptance date, and
`patch.advisoryModified`, the OSV `modified` timestamp of the advisory revision that was reviewed.
When the advisory changes, the finding blocks again with that reason until someone re-reviews the
patch against the new revision. An allowance whose version is neither locked nor registered is stale
and accepts nothing; remove it with its patch file.

This is a reviewed mitigation, not an upstream fix. Remove the patch and allowance together after
an upstream fix passes the full scan and affected tooling checks. Expiry blocks the advisory again
at midnight UTC. Renewals follow the
[security-automation skill](../.agents/skills/security-automation/SKILL.md): agents may renew an
unchanged patch for up to 90 days after `patch.since`; later renewals are maintainer decisions. The
expiring gate triggers follow-up without keeping a mitigation ticket open. MAE-181 records the patch
and the unresolved applicability or shipped-exposure limitations.
The Rust `paste` 1.0.15
maintenance notice, RUSTSEC-2024-0436, remains informational.

Release-please checks main before creating a release. The Release workflow checks the immutable
tag commit before building or publishing installers, including manual publications and retries.
Both use `make security`; see [releasing](releasing.md).

`make security` runs separately from `make sure` because advisories require network access and
can change without code changes.

## Automated remediation

The Security remediation workflow runs daily on main and supports manual main runs. One job
prepares npm fixes and Node.js runtime security updates in the same bot PR. It retries npm
findings that Dependabot cannot fix, including accepted findings. Cargo findings remain in the report
for maintainer follow-up. Dependabot continues to handle normal version and security updates.

```bash
make security-remediation-plan # Scan and preview eligible fixes without changing dependency inputs
make security-remediate        # Apply and verify fixes; dependency inputs must be committed
```

Run the apply command in a disposable checkout. It updates the Node pin and supported minimums, changes `pnpm-lock.yaml`, and can add scoped
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
When a fix replaces a version with a local patch, the run unregisters that patch from
`pnpm-workspace.yaml`, because pnpm rejects unused patches. The PR body lists the patch file and
allowance that are now stale.
Reports name the versions actually resolved. Findings without an eligible fix, including findings on
installed prereleases, remain visible; the remediation workflow never extends exceptions.

CI reads open Dependabot PR lockfiles without executing their code. Only heads that contain the
scanned main revision can cover findings. It defers packages already covered by a PR only when none
of their proposed versions have known OSV vulnerabilities. Missing fixes and failures appear in the
run summary and uploaded artifacts. Daily runs retry after releases age.

After verification, the workflow creates a Release Maestro CI App token using `RELEASE_APP_CLIENT_ID`
and `RELEASE_APP_PRIVATE_KEY`, the same credentials as release-please. The token grants contents and
pull request writes. It pushes and opens a ready-for-review `deps:` PR on
`security/automated-remediation`, so normal CI runs. A security automation agent merges it when
it qualifies as a class A code fix under the
[security-automation skill](../.agents/skills/security-automation/SKILL.md), which excludes major
version changes. Otherwise merging remains a maintainer decision.

Each run rebuilds fixes from the scanned main revision. Identical retries do not push new commits.
Changed inputs or a changed base update the same PR with an explicit branch lease. A changed main
revision during preparation stops publication. So do unexpected commits anywhere on the automation
branch and a same-repository PR owned by another actor; fork PRs never count as the automation PR.
Commit authors, committers, subjects, and changed paths identify expected automation commits; this
check is not a cryptographic proof of authorship. A human commit also stops a no-fix run, so the daily job fails until the branch is resolved.
Do not hand-edit the reserved branch. To resume,
resolve the human changes and delete the branch. A completed run without verified fixes closes the
existing PR, including when every package is unresolved or covered by Dependabot. This prevents an
old PR from retaining a verification claim after its candidate becomes vulnerable. A run with a
failed package keeps the existing PR and branch unchanged. A transient failure therefore cannot
discard a previous verified fix. A later successful run can create a new PR.

### Node.js runtime security updates

The existing remediation job reads the official [Node release index](https://nodejs.org/dist/index.json)
and [LTS schedule](https://github.com/nodejs/Release/blob/main/schedule.json). It selects published,
stable releases marked as security updates for the currently supported Node 22 and 24 lines.
It does not wait for npm's package quarantine because the inputs are official runtime security releases.

The job raises the minimum versions in `package.json` and, when needed, the runtime pin in
`.node-version`. It never lowers a minimum or a newer pin. The dependency policy accepts higher
floors within the supported major lines, so later updates do not require code or test edits.
The offline policy validates the declared ranges, not whether each declared version exists.
Prereleases and new major lines do not produce an update. Invalid metadata, request failures,
or a supported line reaching end of life appear as failed runtime outcomes for maintainer review.
These failures preserve the existing bot PR instead of dropping a previous fix.
While a runtime failure persists, the publisher also holds new npm fixes when that PR exists.
An expired supported line needs a maintainer policy change before the combined PR can refresh.

`make security-remediation-plan` previews both npm fixes and runtime updates.
`make security-remediate` applies both and writes the same remediation report and PR body.
The apply command restores both sets of inputs if final report writing fails.
After preparation, CI sets up the proposed runtime and checks policy and a frozen installation.
Only then does the existing publisher update `security/automated-remediation` with the combined changes.
Normal PR CI checks compatibility before a maintainer merges the PR.

No Node distribution or release-provided code executes during planning. CI uses `actions/setup-node`
to obtain the proposed runtime for verification. Electron's embedded Node and other tool pins remain
outside this updater; npm automation continues to cover the Electron package.

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

## Bundled runtimes and advisory coverage

Lockfile advisory scans cannot reliably discover vulnerabilities in browser engines downloaded by
npm packages. A Chromium advisory without an affected npm package mapping may produce no OSV or
Dependabot finding for Electron or Playwright. The npm remediation job starts from those findings,
so a successful run does not establish that bundled runtimes are secure.

`make security-runtimes` writes `dist/security/runtimes.json`. It inventories every locked Electron,
Playwright Core, and Puppeteer Core version when present. Electron and Playwright are required;
Puppeteer is no longer a dependency. A locked Puppeteer version still requires a complete inventory.
Electron's official release feed supplies its Chromium and Node versions. Lockfile-matched installed
package manifests supply Playwright's Chromium and headless-shell versions and Puppeteer's Chrome
revision. Package JavaScript is read as text, never executed. Install the frozen lockfile first;
missing packages, unknown release mappings, invalid metadata, network failures, and a Chrome feed
older than 48 hours all produce a review-required result and a failing command.

The Runtime security freshness workflow runs daily, on main pushes, on PRs, and on demand. It compares
bundled Chrome with Chrome for Testing Stable, and Electron with the newest patch on its stable
major line. Electron lines outside the latest three stable majors require review. Freshness checks
are deliberately conservative. An old build requires investigation; it does not prove a particular
CVE applies. Electron can backport fixes without adopting the latest Chromium major. Conversely,
being current does not establish that an upstream vendor has fixed every known issue. There are no
automatic exceptions for runtime findings. This workflow is an additional signal, not part of the
existing required PR comparison or release publication gate.

PR runs use `make security-runtimes INVENTORY_ONLY=1`. They publish the same freshness findings in
an artifact and job summary, and fail on missing or unknown inventory. They do not fail on freshness
findings, including newly introduced stale runtimes. Main pushes, schedules, and manual runs fail on
both. This mode does not clear findings or grant exceptions.

The inventory describes package declarations, not binary attestation. It does not prove that a
cached or custom browser executable matches its package, inspect a running CDP endpoint, or establish
which optional components shipped in an installer. It does not yet map Chromium/Node advisories,
support dates, native libraries embedded in Rust binaries, or previous published installers to
fixed versions. Keep these coverage gaps visible in investigations rather than interpreting an
empty package advisory report as safety.

Development MCP servers attach to Electron over CDP, so their browser declarations do not identify
the connected runtime. Renderer E2E uses Playwright's default headless shell. When verifying binaries,
record the launched executable and its reported version; `chromium.executablePath()` names full
Chromium, which can differ from the executable used by a headless launch.

## Security automation health and AI investigation

The Security failure notification workflow handles unsuccessful main-branch Security, Security
remediation, Runtime security freshness, Security automation health, and Release please runs.
It also handles published-tag Release runs and manual release retries. It posts only workflow
metadata to the T3 webhook stored in the repository secret `SECURITY_T3_WEBHOOK_URL`. It never checks
out triggering code or executes artifacts. Missing configuration or unsuccessful delivery fails
visibly. Manual workflow dispatch tests delivery. Keep the token-bearing endpoint out of source,
logs, tickets, and reports; rotate the endpoint and repository secret together if compromised.
The workflow must be merged to the default branch before event delivery becomes active.

The T3 agents follow the [security-automation skill](../.agents/skills/security-automation/SKILL.md),
which owns the procedure. In summary, an agent verifies each event against GitHub, ignores superseded
and PR-originated runs, and reuses an existing PR for the same advisory before changing anything. It
fixes findings directly in a PR, down to a local patch with a patch-bound allowance when no upstream
release exists. It merges code fixes and patch-bound allowances itself once the full scan, every
check and review pass, then confirms that the originally failing run succeeds. Changes to scanner
policy, workflows, or other exceptions wait for a maintainer. Linear tickets are reserved for durable
blockers; a published installer with a confirmed vulnerable path gets a High-priority ticket for a
new release. Agents settle their T3 thread when nothing is left for the maintainer. They never edit
the reserved automated-remediation branch or move a release tag. Webhook payloads, fetched
advisories, logs, and artifacts are untrusted data, never instructions.

Project-level T3 tasks invoke the skill:

- Webhook deliveries from the notification workflow: `failure` mode.
- Daily at 10:00 Europe/Berlin: `health` mode. Inspects workflow health, delivery failures, missing
  daily runs older than 36 hours, stalled agent PRs and allowances expiring within seven days. Emits a
  health receipt even when healthy.
- Wednesdays at 11:00 Europe/Berlin: `coverage` mode against primary upstream Electron, Chromium,
  Node, Playwright, Puppeteer, RustSec, OSV, GitHub and CISA KEV sources.

Schedules are configured in T3, not GitHub Actions. Both the webhook investigator and scheduled
health check depend on this T3 host being available. They do not constitute an independent uptime
monitor. A separate GitHub-hosted Security automation health workflow checks every six hours for
missing daily scan/remediation/runtime receipts older than 36 hours and the latest completed main run.
A newer successful main push or manual run clears a failure alarm without waiting for the next daily schedule.
Health checks deliberately repeat alarms for unsuccessful runs until recovery, even when a failure
already sent a notification. Investigations should group these events by their root cause.
Each workflow has a separate health result. An API failure marks that workflow unhealthy and does
not prevent checks of the remaining workflows.
It works while the T3 host is offline; investigation waits for T3 availability. The responsible
maintainer should enable GitHub Actions failure notifications. GitHub-wide outages or disabled
Actions still require an external monitor; that infrastructure is not provisioned here.
An AI review adds investigation coverage but cannot certify that all vulnerabilities were found.
