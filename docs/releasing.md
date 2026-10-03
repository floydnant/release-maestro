# Releasing Release Maestro

Merge the release-please PR to release the application. The first release is
`v0.1.0`. Later release PRs collect changes merged into `main` and update root
`package.json`, `CHANGELOG.md`, and `.release-please-manifest.json`.
The integration already sets `package.json` to `0.1.0`, so the first release PR
may only add the changelog and manifest entry.

The Release please workflow uses the Release Maestro CI GitHub App to open PRs
and create tags and GitHub releases. Its App token lets those events run the PR
checks and Release workflow automatically.

## Release flow

1. Merge application or dependency changes into `main`. Release-please creates
   or updates the pending release PR.
2. Review its proposed version and notes, wait for its CI checks, and squash
   merge it. Keep the release-please title and body so the bot can identify it.
3. Release-please creates a `v` tag and publishes a GitHub release containing
   the notes from the changelog.
4. The Release workflow resolves the tag to its commit and checks that the
   commit belongs to `main` and its package version matches the tag.
5. The shared Build workflow runs production Electron E2E and creates installers
   on Linux, macOS, and Windows from that same commit.
6. After all three builds pass, the publish job attaches the installers and any
   generated updater metadata to the existing GitHub release.

The GitHub release exists while installers build. Its download links become
available when the publish job finishes. This workflow does not merge the release
PR automatically.

## Versions and commit types

| Commit type                                 | Version change                    |
| ------------------------------------------- | --------------------------------- |
| `fix`, `perf`, `deps`, `build`, or `revert` | Patch, such as `0.1.0` to `0.1.1` |
| `feat`                                      | Minor, such as `0.1.0` to `0.2.0` |
| Breaking change before `1.0.0`              | Minor                             |
| Breaking change at or after `1.0.0`         | Major                             |

Dependency PRs use `deps:` and produce patch releases. Existing `build(deps):`
commits also qualify. The visible `build` section means other build changes can
produce patch releases too. Routine `docs`, `chore`, `ci`, `refactor`, `style`,
and `test` commits stay hidden unless they declare a breaking change.

Squash commit subjects must use Conventional Commits. The PR-title check runs
automatically, but check the final squash subject too because GitHub can use a
single commit's subject instead of the PR title. For a deliberate version
override, add a `Release-As: 1.0.0` footer to the commit merged into `main`.

There are no separately published library or sidecar releases. The private
library versions and Cargo crate version stay independent. The custom Electron
Webpack config sets the generated app manifest to the root version. Root version
changes invalidate the Electron build and packaging caches.

## Installer names and links

| Platform                       | GitHub release asset                                                            |
| ------------------------------ | ------------------------------------------------------------------------------- |
| macOS, Apple Silicon and Intel | `Release-Maestro-macOS-universal.dmg` and `Release-Maestro-macOS-universal.zip` |
| Windows, x64                   | `Release-Maestro-Windows-x64.exe`                                               |
| Linux, x64                     | `Release-Maestro-Linux-x64.AppImage`                                            |

Asset names stay the same between versions. Use
`https://github.com/floydnant/release-maestro/releases/latest/download/<asset>`
for a link to the newest release. Replace `latest/download` with
`download/v0.1.0` to link to that particular version.

The macOS builder also emits native installers for the runner's architecture.
The release includes those files and their blockmaps too, so any generated
updater metadata points to uploaded assets. The README links to the universal DMG.

The packaging targets use `publishPolicy: never`. The separate publish job owns
uploads, so restoring a cached installer does not skip uploading it. Installer
signing and in-app automatic updates belong to MAE-60 and MAE-58.

## GitHub App setup

The private App is [Release Maestro CI](https://github.com/settings/apps/release-maestro-ci),
owned by `floydnant`. It needs repository Contents, Issues, and Pull requests
permissions set to read and write. Metadata read access is mandatory. Webhooks,
OAuth user authorization, and access to other accounts are unnecessary.

1. Generate a private key on the App settings page. Keep the downloaded PEM private.
2. Install the App on the `floydnant` account, selecting only `release-maestro`.
3. Set the repository Actions variable `RELEASE_APP_CLIENT_ID` to the App's
   public Client ID.
4. Set the repository Actions secret `RELEASE_APP_PRIVATE_KEY` to the complete
   PEM contents, including its header, footer, and line breaks. An OAuth client
   secret is unnecessary.

The token action restricts each token to the current repository and the three
required permissions. It revokes the token when the job ends. Installer uploads
use that publishing job's `GITHUB_TOKEN` with Contents write permission.

## Retrying publication

Re-run a failed Release workflow, or manually run the Release workflow on `main`
with the existing tag, such as `v0.1.0`. It rebuilds and tests that tag's commit,
then replaces matching assets using `gh release upload --clobber`. The tag,
version, and release notes stay intact. Do not bump the version just to retry an
installer upload.

The workflow refuses missing, draft, prerelease, or version-mismatched releases.
It also refuses to upload unless every platform's expected installer exists
and is nonempty.

## Verification

Run `make test-tools`, `make dependency-policy-check`, and `make format-check`
for release scripts, action references, and formatting. Use `actionlint` when
available to check the workflow wiring. Use `make package` and
`make e2e-production` to check installers and production behavior for the host OS.
GitHub runs both production checks and installer creation on all three release
platforms.

The original investigation and pinned upstream sources are in
[the MAE-56 research note](research/mae-56-release-please.md).
