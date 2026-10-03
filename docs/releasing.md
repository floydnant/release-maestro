# Releasing

Merge the release-please PR to publish a version. The bot maintains root
`package.json`, `CHANGELOG.md`, and `.release-please-manifest.json`.

## Release flow

1. Merge application or dependency PRs into `main` using Conventional Commits.
2. Review and merge the bot's release PR. Keep its title and body.
3. Release-please creates the tag and publishes the GitHub release notes.
4. The Release workflow tests and builds that commit on Linux, macOS, and Windows.
   Builds also save per-platform SBOMs as Actions artifacts.
5. After all builds pass, the workflow attaches installers and updater metadata.

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
The version, tag, and release notes stay intact.

Missing, draft, prerelease, and version-mismatched releases fail validation.
Uploads also require every platform's installer to exist and be nonempty.

## Local checks

Use `make package` and `make e2e-production` for packaging on the host OS.
Use `make test-tools`, `make dependency-policy-check`, and `make format-check`
for release tooling. Signing and automatic updates remain MAE-60 and MAE-58.
