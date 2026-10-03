# Security checks and dependency inventories

CodeQL runs through GitHub's default setup. It covers TypeScript, Rust, and GitHub Actions.
The latest setup also includes Python. Keep this hosted analysis enabled.
GitHub secret scanning and push protection are enabled. Dependabot maintains npm, Cargo, and
GitHub Actions dependencies. The pnpm dependency policy restricts provenance, release age,
dependency sources, and install scripts.

## Local commands

After `make install`, use:

```bash
make security              # Scan both lockfiles against current OSV advisories
make sbom                  # Generate source dependency inventories
make package               # Build the distributable for this host
make sbom-release          # Add an inventory of dist/executables
make sbom-release ARTIFACT_DIR=dist/packages # Inspect an unpacked package instead
make security-policy-check # Validate exception records without network access
```

`make security-tools` downloads the scanners without running a scan. Other commands download their
required scanner on first use. Versions and SHA-256 digests are committed in
`tools/security/tools.json`. The downloader checks cached and downloaded bytes before execution.
It supports macOS, Linux, and Windows on x64 and arm64. Node and `tar` are required. Rust metadata
requires the locked crates fetched by `make install`. A corrupted tool cache fails verification;
remove `.cache/security-tools` to download it again. Review versions and digests together when
updating tools. No dependency lifecycle scripts or Rust call-analysis builds run during scanning.

## Vulnerability gate

OSV-Scanner checks `pnpm-lock.yaml` and `apps/metadata-engine/Cargo.lock`, including development and
transitive dependencies. Findings stay in `dist/security/osv.json`; the gate writes
`dist/security/findings.json` with the disposition of each finding. The Security workflow runs on
PRs, pushes to main, daily, and on demand. It retains reports even when the gate fails.

Every security advisory blocks the gate unless an exact exception applies. Missing severity does
not make a finding safe. Unscored RustSec maintenance notices are informational; unsoundness is
blocking. Scanner errors, incomplete ecosystem coverage, invalid exceptions, and expired exceptions
fail the command. The active
[Dependency security ruleset](https://github.com/floydnant/release-maestro/rules/24417605) requires
the `Dependency vulnerabilities` check before a PR can merge into the default branch.

The initial baseline contains 28 existing findings accepted until November 2, 2026. These affect Nx,
Electron download tooling, the webpack pipeline, drizzle-kit, and Bandcamp/Puppeteer dependencies.
The reasons in `tools/security/exceptions.json` describe the dependency and risk. Acceptance is a
temporary rollout decision, not evidence that the dependency is safe. Upgrade or replace these
dependencies and remove the exceptions before expiry.

An exception must name the ecosystem, package, exact version, advisory ID, reason, and UTC expiry
date. It expires at the start of that date. A changed package version or a new advisory gets no
exception. Keep exceptions short, normally no more than 30 days. Review each extension in a PR;
never regenerate the baseline automatically or suppress a whole package or ecosystem. Remove
exceptions after the affected dependency leaves the lockfile. `make security` is separate from
`make sure` because advisory lookups require network access and can change without code changes.

## SBOM outputs

Syft produces CycloneDX 1.6 JSON documents in `dist/security`:

- `repository.cdx.json` includes the full npm and Cargo lockfile inventories. Each component has a
  `release-maestro:dependency-scope` property with `runtime` or `development`.
- `runtime.cdx.json` includes the source dependency graph reachable from production npm dependencies
  and normal Cargo dependencies. It includes Electron explicitly, plus the renderer's translation
  dependencies that currently live in `devDependencies`. Shared dependencies remain runtime.
- `artifact.cdx.json` comes from the actual package directory when running `make sbom-release`.
- `provenance.json` records the git revision, host platform, architecture, and input-file checksums.

Source generation stages only the authoritative manifests and lockfiles. Installed modules, build
caches, and fixture projects cannot contaminate that inventory. The source graph conservatively
includes optional and platform-specific dependencies. It does not claim that every source dependency
has bytes in each platform's final package. Build tools and Rust test dependencies stay distinguishable.

Keep the source and artifact documents together. A filesystem scan alone cannot identify every
library bundled into JavaScript, Electron's ASAR archive, or an ordinary Rust binary. The source
inventory supplies the Angular, Electron, native-module package, and Rust dependency versions;
the artifact scan adds packages identifiable on disk. These documents do not replace Electron's
upstream Chromium/Node inventory or identify every native library compiled into a third-party binary.
License fields are only as complete as the scanned metadata; this change adds no license allowlist.

The Build workflow generates and uploads this set after packaging on Linux, macOS, and Windows.
The Security workflow also uploads the source inventories independently of packaging. A future
publishing workflow should attach the same files to each published release.

Electron renderer isolation, IPC validation, and media compatibility are tracked separately in
[MAE-167](https://linear.app/floyd-haremsa/issue/MAE-167/harden-electron-renderer-isolation-and-ipc-access).
