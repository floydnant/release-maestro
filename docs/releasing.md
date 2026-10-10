# Releasing

Merge the release-please PR to publish a version. The bot maintains root
`package.json`, `CHANGELOG.md`, and `.release-please-manifest.json`.

## Release flow

1. Merge application or dependency PRs into `main` using Conventional Commits.
2. Review and merge the bot's release PR. Keep its title and body.
3. Release-please maintains its PR independently of the security backlog. Before creating a tag
   and publishing release notes, the workflow runs `make security` on current main and checks that
   main has not advanced during the scan.
4. The Release workflow resolves the immutable tag commit and runs another full security scan.
   After that passes, it tests and builds that commit on Linux, macOS, and Windows.
   Builds also save per-platform SBOMs as Actions artifacts.
5. After all builds pass, the workflow attaches installers and updater metadata.

Unaccepted security advisories block release creation on main. The tagged-commit scan blocks
installer publication, including manually created releases and retries. Exact, unexpired exceptions
apply to these full scans; the PR comparison alone does not establish release readiness.
See [security policy](security.md) for the remediation and exception workflow.

The release appears before its installers. Downloads become available when the
upload finishes. Stable filenames support the [README download links](../README.md#download).

`feat` commits produce minor releases. `fix`, `perf`, `deps`, `build`, and `revert`
produce patch releases. Breaking changes produce minor releases below `1.0.0`
and major releases afterwards. Other commit types stay hidden unless breaking.
See [the release configuration](../release-please-config.json) to change these rules.

## App setup

Install [Release Maestro CI](https://github.com/settings/apps/release-maestro-ci)
on this repository with Contents, Issues, and Pull requests write permissions.
Set the repository Actions variable `RELEASE_APP_CLIENT_ID` and secret
`RELEASE_APP_PRIVATE_KEY` to the App's Client ID and complete PEM key.

The App token lets bot PRs run CI and published releases start the Release workflow.
Installer uploads use the publish job's `GITHUB_TOKEN`.

## Retry a failed publication

Re-run the failed Release workflow, or run it manually on `main` with the existing
published tag, such as `v0.1.0`. It builds that commit and replaces matching assets.
The version, tag, and release notes stay intact. The retry rescans the tagged lockfiles against
current advisories and uses the exceptions committed at that tag. Updating main does not repair
an old tag; a vulnerable tagged release may require a new release.

Missing, draft, prerelease, and version-mismatched releases fail validation.
Uploads also require every platform's installer to exist and be nonempty.

## Local checks

Use `make package` and `make e2e-production` for packaging on the host OS.
Run `make security` before publishing. Use `make test-tools`, `make dependency-policy-check`, and `make format-check`
for release tooling. Signing and automatic updates remain MAE-60 and MAE-58.
