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
replace a corrupt cache. Review tool versions and checksums together when updating them.

## Vulnerability gate

OSV-Scanner checks all dependencies in both lockfiles. The Security workflow runs on PRs,
main, daily, and on demand. The
[Dependency security ruleset](https://github.com/floydnant/release-maestro/rules/24417605) requires
`Dependency vulnerabilities` before merging. Reports are `dist/security/{osv,findings}.json`;
CI uploads them even on failure.

Security advisories block unless an exact exception applies, including advisories without severity.
Unscored RustSec maintenance notices are informational; unsoundness blocks. Scanner errors,
missing ecosystem coverage, and invalid or expired exceptions also fail.

`tools/security/exceptions.json` accepts 28 existing findings until November 2, 2026.
Exceptions require ecosystem, package, exact version, advisory ID, reason, and UTC expiry date.
They expire at the start of that date; new versions or advisories still block. Keep exceptions within
30 days, review extensions in a PR, and remove them after fixes. Never regenerate the baseline
automatically or suppress whole packages. Acceptance does not establish safety.

`make security` runs separately from `make sure` because advisories require network access and
can change without code changes.

## SBOMs

Syft writes CycloneDX 1.6 JSON to `dist/security`:

| File                  | Contents                                                        |
| --------------------- | --------------------------------------------------------------- |
| `repository.cdx.json` | All lockfile dependencies, tagged as runtime or development     |
| `runtime.cdx.json`    | Production dependency graph, including Electron                 |
| `artifact.cdx.json`   | Packages identifiable in the directory passed to `sbom-release` |
| `provenance.json`     | Git revision, platform, architecture, and input checksums       |

Source SBOMs use manifests and lockfiles only. Runtime scope also includes renderer translation
packages currently in `devDependencies`. Optional and platform-specific dependencies may not ship.

Keep source and artifact SBOMs together. Filesystem scans miss dependencies bundled in JavaScript,
ASAR, or Rust binaries. Electron's upstream Chromium/Node inventory and embedded native libraries
need separate coverage. License metadata may be incomplete; there is no license allowlist.

CI uploads source SBOMs and the full set after Linux, macOS, and Windows packaging.
Future release publishing should attach the same files.

Electron hardening is tracked in [MAE-167](https://linear.app/floyd-haremsa/issue/MAE-167/harden-electron-renderer-isolation-and-ipc-access).
