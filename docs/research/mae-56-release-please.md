# MAE-56 release-please exploration

Research date: 2026-10-03. Issue: [MAE-56](https://linear.app/floyd-haremsa/issue/MAE-56/add-release-please).

The release unit is the Electron application at the repository root.
Use release-please manifest mode with one `node` package at `.`. The recurring
release PR should update the application version, release notes, and the
release-please version manifest. Treat the Rust crate's version as an independent
internal version unless we choose to synchronize it with the application.

The initial exploration was read-only. The accepted implementation starts at
`0.1.0`, makes dependency updates releaseable, uses the Release Maestro CI App,
and builds and attaches all platform installers after merging a release PR.
See [the release guide](../releasing.md) for the implemented workflow and setup.

## Initial repository findings

The checkout and GitHub `main` both point to `920d177db98dbd94422f774d6f1572afe7edc2c4`.
MAE-56 is Todo with no description, comments, or blocking relations. Its Release
Readiness project already has separate work for
[automatic updates, MAE-58](https://linear.app/floyd-haremsa/issue/MAE-58/automatic-updates)
and [macOS signing, MAE-60](https://linear.app/floyd-haremsa/issue/MAE-60/add-macos-build-signing-in-ci).
MAE-58 depends on MAE-60. These findings came from the Linear MCP, including the
issue comments.

| Existing file or setting                                                                                                                | What it means for release-please                                                                                                                                           |
| --------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [Root package manifest](../../package.json)                                                                                             | Application version is `1.0.0`. It is private and ships as an Electron application. No npm publication is needed.                                                          |
| [Core manifest](../../libs/maestro-core/package.json) and [ESLint plugin manifest](../../libs/eslint-plugin-design-system/package.json) | Both are private at `0.0.1`. Their versions do not determine the app version.                                                                                              |
| [Cargo manifest](../../apps/metadata-engine/Cargo.toml) and [Cargo lockfile](../../apps/metadata-engine/Cargo.lock)                     | The bundled sidecar has its own `0.1.0` version. Its CLI and ping response expose that version, separately from protocol version `1`.                                      |
| [Build workflow](../../.github/workflows/build.yml)                                                                                     | Builds Linux, macOS, and Windows installers using `make package` on main pushes, PRs, and manual dispatch. Artifact uploads are commented out.                             |
| [Electron builder config](../../electron-builder.json)                                                                                  | GitHub publishing points to `floydnant/release-maestro`. The configured formats are AppImage, universal macOS packages, and an x64 NSIS installer.                         |
| [Makefile](../../Makefile)                                                                                                              | `make version` generates and stages a changelog. It does not bump a version, despite its help text. Remove this competing changelog writer when release-please takes over. |
| [PR title workflow](../../.github/workflows/pr-title.yml)                                                                               | Already validates Conventional Commit titles, including `chore(main): release 1.0.0`.                                                                                      |
| [Dependency policy checker](../../tools/verify-dependency-policy.mjs)                                                                   | Requires every external GitHub Action reference to use a full commit SHA. Dependabot already updates actions.                                                              |

GitHub currently has no tags or releases. There is no tracked `CHANGELOG.md` or
release-please configuration. The one local tag, `pr-101-media`, is an unrelated
development tag. The first release should use the explicit bootstrap policy
below, rather than treating the current package version as a past release.

GitHub allows only squash merges. Its squash subject setting is
`COMMIT_OR_PR_TITLE`, so a single-commit PR can use that commit's subject instead
of the checked PR title. Set it to `PR_TITLE` or require the maintainer to check
the final squash subject. That closes a gap between the title check and the
history release-please reads.

At the start of the investigation, the repository's default workflow permission
was read. The API reported `can_approve_pull_request_reviews: false`, and the
repository secret-name list was empty. The integration now uses the GitHub App
described below.
These are observations from the GitHub repository, tags, releases, merge
settings, Actions permissions, and secret-name APIs on the research date. No
secret values were read.

### Version changes need to invalidate Nx caches

The installed nx-electron `22.0.0`
[webpack configuration](../../node_modules/nx-electron/src/utils/config.js) reads
root `package.json.version` for `__BUILD_VERSION__`. The environment files and
`get-app-version` IPC handler consume that compiled value.

Its older package-json utility also reads the root version, but the current
[build executor](../../node_modules/nx-electron/src/executors/build/executor.js)
uses Nx's `createPackageJson` instead. Packaging verification found that this
generated manifest defaults to `0.0.1`. The integration corrects that version
in the custom Electron Webpack config.

I inspected the effective targets with
`pnpm exec nx show project maestro-electron --web false` and inspected their
file inputs with the installed Nx `HashPlanInspector`. All four cached targets,
`build-app`, `build-e2e`, `make`, and `package`, exclude root `package.json`.
The packaging targets also exclude `electron-builder.json`.
[Target configuration](../../apps/maestro-electron/project.json),
[shared inputs](../../nx.json).

This creates a release-specific failure path. A release PR can change only the
root version while Nx restores an old compiled version and generated manifest.
Add root `package.json` to those targets' inputs, and add `electron-builder.json`
to `make` and `package`. Keep these inputs in the Electron project so unrelated
renderer tests do not rerun for app-version changes.
[Nx input behavior](https://nx.dev/docs/reference/inputs).

## Verified upstream version

The latest published action is `googleapis/release-please-action` v5.0.0,
released on 2026-04-22. Its commit is
`45996ed1f6d02564a971a2fa1b5860e934307cf7`. It uses the Node 24 action runtime
and bundles release-please 17.6.0. Pin that full SHA when implementing. The
README's v4 examples are older than the published release.
[Action release](https://github.com/googleapis/release-please-action/releases/tag/v5.0.0),
[action definition](https://github.com/googleapis/release-please-action/blob/v5.0.0/action.yml),
[bundled dependency version](https://github.com/googleapis/release-please-action/blob/v5.0.0/package-lock.json).

The source references below use release-please v17.6.0 where behavior depends on
the bundled implementation. Current upstream `main` and older examples do not
always describe the same defaults.

## Release flow and configuration

Manifest mode supports a single application as well as multiple published
packages. The `.` package collects changes across the repository. Separate Nx
projects do not require separate release-please packages. A multi-package setup
would create component versions and releases for each configured package, which
we only need if those packages ship independently.
[Manifest documentation](https://github.com/googleapis/release-please/blob/v17.6.0/docs/manifest-releaser.md).

The action should run on pushes to `main`. In manifest mode it reads
`release-please-config.json` and `.release-please-manifest.json` from GitHub, so
the release job itself does not need checkout, dependency installation, or a
build. Put `release-type: node` inside the config, not in the action's `with`
block. Supplying the action input switches to its simpler generated
configuration and bypasses the manifest files.
[Action implementation](https://github.com/googleapis/release-please-action/blob/v5.0.0/src/index.ts).

Release-please maintains a release PR while changes accumulate. Merging that PR
lands the version and changelog changes. The next action run finds the merged PR,
creates its tag and GitHub Release, then checks for another release PR. Default
lifecycle labels are `autorelease: pending` and `autorelease: tagged`.
[Release lifecycle](https://github.com/googleapis/release-please/blob/v17.6.0/docs/customizing.md#release-lifecycle-labels).

The root config should set `include-component-in-tag: false` for application
tags such as `v1.0.0`. Manifest mode otherwise includes a component name by
default. A `node-workspace` or `cargo-workspace` plugin is unnecessary for one
application release.
[Tag and plugin configuration](https://github.com/googleapis/release-please/blob/v17.6.0/schemas/config.json).

## What the recurring release PR changes

| File                            | Change                                                                                     |
| ------------------------------- | ------------------------------------------------------------------------------------------ |
| `package.json`                  | Set the root `version` to the proposed application version.                                |
| `CHANGELOG.md`                  | Add a version heading and notes derived from eligible commits. Create the file if missing. |
| `.release-please-manifest.json` | Set the `.` entry to the proposed application version.                                     |

The Node strategy updates `package.json` and the changelog. Manifest mode adds
the version-manifest update. The configuration file normally stays unchanged.
The integration sets root `package.json` to `0.1.0`. The first release PR can
therefore contain only the changelog and manifest changes.
[Node strategy](https://github.com/googleapis/release-please/blob/v17.6.0/src/strategies/node.ts),
[manifest PR builder](https://github.com/googleapis/release-please/blob/v17.6.0/src/manifest.ts#L768-L801).

The Node strategy knows `package-lock.json` and `npm-shrinkwrap.json`; it does
not update `pnpm-lock.yaml`. Do not add the pnpm lockfile as a generic YAML
extra file. Its `lockfileVersion` describes the pnpm format, and dependency
versions are not the application's version. A root-only version bump changes
neither dependencies nor an independently published workspace package version.
The frozen install should be checked against the resulting PR.
[Node lockfile updater selection](https://github.com/googleapis/release-please/blob/v17.6.0/src/strategies/node.ts#L36-L46).

Likewise, root Node release configuration does not discover and bump every
`package.json` below it. Independent internal package manifests need no changes
unless they are deliberate application-version copies. For such copies,
`extra-files` supports a JSON entry with `jsonpath: "$.version"`.
[Extra-file configuration](https://github.com/googleapis/release-please/blob/v17.6.0/src/strategies/base.ts#L392-L498).

## First release and history boundary

There is a difference between the first version to publish and a version that
we claim was already published. For the first application release of `0.1.0`,
use an empty version manifest and explicit `initial-version: "0.1.0"` in the
root package config. The Node strategy inherits a `1.0.0` first-release default
from its base class. The manifest docs' older `0.1.0` Node example is stale.
[Initial-version implementation](https://github.com/googleapis/release-please/blob/v17.6.0/src/strategies/base.ts#L744-L750).

Seeding the manifest with `{ ".": "1.0.0" }` instead treats `1.0.0` as the
previous version, even without a matching release. A feature commit would then
propose `1.1.0`. A manifest entry of `0.0.0` does not create that synthetic
previous version. An empty manifest expresses the absence of a previous release
more clearly.
[Manifest fallback](https://github.com/googleapis/release-please/blob/v17.6.0/src/manifest.ts#L706-L730).

Choose a changelog history boundary separately from the version:

| Option                     | Meaning                                                                                                                                    |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| `bootstrap-sha`            | Stop before this full commit SHA while no matching previous release exists. Use the commit immediately before the first change to include. |
| `last-release-sha`         | Override the stop point on every run. Intended for recovery. Remove or change it after recovery.                                           |
| `initial-version`          | Set the first release version when there is no previous release.                                                                           |
| `Release-As` commit footer | Override the version for the pending release.                                                                                              |
| `release-as` config        | Persistent version override. The schema deprecates it in favor of a commit footer. Remove it after use.                                    |

Without a boundary the first run gathers older history up to the configured
commit-search limit, which defaults to 500. Setting the boundary to the
integration commit can leave no eligible feature or fix to release until later
work lands. Decide whether `0.1.0` notes should describe existing functionality
or only changes made after adopting release-please.
[Bootstrap documentation](https://github.com/googleapis/release-please/blob/v17.6.0/docs/manifest-releaser.md#bootstrapping),
[configuration schema](https://github.com/googleapis/release-please/blob/v17.6.0/schemas/config.json#L52-L55).

## Commit and dependency-release policy

The default versioning strategy gives breaking changes a major bump, `feat`
commits a minor bump, and other eligible changes a patch bump. Below `1.0.0`,
`bump-minor-pre-major` and `bump-patch-for-minor-pre-major` change that behavior
only if enabled. Squash merge works well because one final commit controls the
release notes for a PR. That final commit still needs the correct type and any
breaking-change or `Release-As` footer.
[Versioning implementation](https://github.com/googleapis/release-please/blob/v17.6.0/src/versioning-strategies/default.ts),
[squash-merge guidance](https://github.com/googleapis/release-please/blob/v17.6.0/README.md#linear-git-commit-history-use-squash-merge).

The bundled Node changelog preset shows `feat`, `fix`, `perf`, and `revert` by
default. It hides ordinary `build`, `chore`, `ci`, `docs`, `refactor`, `style`,
and `test` commits. It has no default `deps` entry. The release-please README's
claim that bare `deps` is always eligible does not match this Node implementation.
An empty changelog causes the strategy to skip the release PR.
[Bundled default sections](https://github.com/googleapis/release-please-action/blob/v5.0.0/dist/index.js#L21303-L21316),
[empty-changelog gate](https://github.com/googleapis/release-please/blob/v17.6.0/src/strategies/base.ts#L308-L322).

I ran the Node strategy from the exact v5.0.0 bundle with a simulated previous
`1.0.0` release. No GitHub writes occurred:

| Commit                              | Default sections | Explicit visible section      |
| ----------------------------------- | ---------------- | ----------------------------- |
| `deps: upgrade a dependency`        | No release PR    | `1.0.1` with visible `deps`.  |
| `build(deps): upgrade a dependency` | No release PR    | `1.0.1` with visible `build`. |
| `perf: improve processing`          | `1.0.1`          | `1.0.1`.                      |

Recommendation: use `deps:` for dependency PRs and add an explicit visible
`deps` changelog section, while keeping routine documentation, tests, CI, and
chores hidden. If we retain `build(deps):`, making all `build` commits visible
is the documented alternative. A scoped `build` section followed by a hidden
generic `build` section also worked in the experiment, but `scope` is absent
from release-please's documented section type. I would avoid that dependency on
an undocumented field.
[Changelog configuration](https://github.com/googleapis/release-please/blob/v17.6.0/src/changelog-notes.ts#L36-L40),
[preset delegation](https://github.com/googleapis/release-please/blob/v17.6.0/src/changelog-notes/default.ts#L65-L69).

## Credentials and packaging handoff

The action defaults to `GITHUB_TOKEN`. Its documented workflow permissions are
`contents: write`, `pull-requests: write`, and `issues: write`. The last supports
label operations. If using the built-in token, the repository must also allow
GitHub Actions to create pull requests.
[Action credential requirements](https://github.com/googleapis/release-please-action/blob/v5.0.0/README.md#workflow-permissions).

Current GitHub documentation has a newer exception to the usual token-trigger
restriction. PRs opened, synchronized, or reopened with `GITHUB_TOKEN` can
create CI runs, but a user with write access must approve them. Other PR activity
types, including `edited`, do not trigger runs. Token-created release and tag
events still do not start downstream workflows. A GitHub App installation token
or PAT allows automatic event-triggered CI. `workflow_dispatch` and
`repository_dispatch` remain exceptions to the trigger restriction.
[GitHub trigger rules](https://docs.github.com/en/actions/how-tos/write-workflows/choose-when-workflows-run/trigger-a-workflow#triggering-a-workflow-from-a-workflow).

Recommendation: use a repository-scoped GitHub App token for automatic release
PR checks. A PAT is simpler to set up but belongs to a user. If we deliberately
use `GITHUB_TOKEN`, record the manual approval step and run packaging downstream
in the same workflow, through action outputs or a reusable workflow call.

The root action emits `release_created`, `tag_name`, `version`, `sha`,
`upload_url`, and `html_url` when it creates a release. Export those as job
outputs. Packaging jobs can require `release_created == 'true'`, check out the
emitted release SHA, and upload installers to the emitted tag's existing release.
Use an explicit string comparison because action outputs are strings.
Release-please itself creates tags and release notes; it does not build or
upload Electron installers.
[Root release outputs](https://github.com/googleapis/release-please-action/blob/v5.0.0/src/index.ts#L167-L205),
[artifact attachment example](https://github.com/googleapis/release-please-action/blob/v5.0.0/README.md#attaching-files-to-the-github-release).

## Proposed implementation changes

These are the one-time integration edits. The recurring release PR has the
smaller file list above.

| File or setting                                  | Proposed change                                                                                                                                                                                                                                                      |
| ------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| New `.github/workflows/release-please.yml`       | Run the SHA-pinned v5 action on main pushes and manual dispatch. Use manifest mode, a repository-scoped credential, and branch-specific concurrency without canceling an in-progress release. Use the App token so publishing a release starts the Release workflow. |
| New `release-please-config.json`                 | Define one root Node release, component-free `v` tags, explicit first version, and the chosen changelog policy.                                                                                                                                                      |
| New `.release-please-manifest.json`              | Start with `{}` because no application release exists. Let the first release PR populate `.`.                                                                                                                                                                        |
| `apps/maestro-electron/project.json`             | Add the missing cache inputs described above. Keep installer creation free of release-upload side effects.                                                                                                                                                           |
| `Makefile`, `package.json`, and `pnpm-lock.yaml` | Remove `make version`, its `.PHONY` entry, and the now-unused direct `conventional-changelog-cli` dependency. Regenerate the pnpm lockfile for that dependency removal. This lockfile change belongs to the integration PR, not ordinary version bumps.              |
| `.github/dependabot.yml`                         | Set `deps:` commit prefixes for npm, Cargo, and GitHub Actions. Keep the existing Action update group.                                                                                                                                                               |
| `README.md`                                      | Describe how release PRs accumulate changes, how merging one creates a release, and how maintainers correct release notes or force a version. Document the dependency commit convention and any manual CI step.                                                      |
| GitHub settings and credentials                  | Create Release Maestro CI with Contents, Issues, and Pull requests write permissions. Install it only on this repository and configure the Client ID variable and private key secret. Check Conventional Commit squash subjects.                                     |

Installer publication also changes `.github/workflows/build.yml` into a reusable
workflow and adds `.github/workflows/release.yml`. The new `tools/release.mjs`
resolves tags, verifies releases, collects installer files, and uploads assets.
Its tests cover incomplete builds and repeated uploads. `electron-builder.json`
defines stable installer names. `docs/releasing.md` documents the release flow.
The custom Electron Webpack config copies the root version into the generated
app manifest.

The minimal root package configuration is:

```json
{
    "$schema": "https://raw.githubusercontent.com/googleapis/release-please/v17.6.0/schemas/config.json",
    "packages": {
        ".": {
            "release-type": "node",
            "initial-version": "0.1.0",
            "include-component-in-tag": false
        }
    }
}
```

This minimal example leaves default changelog sections intact. The implemented
config also enables visible `deps` and `build` sections for dependency releases,
and uses minor bumps for breaking changes before `1.0.0`.
The first release is `0.1.0` and includes the existing eligible history.
There are only 172 commits, within the default search limit, and no previous
published release to compare against. Review those generated notes before merge.
Use a chosen `bootstrap-sha` if a shorter first changelog is preferable.

### Installer publication

For downloadable GitHub releases, add an explicit publishing job or workflow
that reuses the three platform builds. Check out the emitted release SHA, run
`make package`, and upload the distributables from `dist/executables/` to the
existing release with `gh release upload`. Do not let electron-builder create a
second release or replace release-please's notes.

The installed nx-electron package executor passes a null publication policy
today, which disables implicit publishing in the installed electron-builder.
Set `publishPolicy: "never"` explicitly if publishing uses `gh`. Perform uploads
outside the cached Nx packaging target. This allows a cached installer to upload
without depending on a build side effect.
[Installed package executor](../../node_modules/nx-electron/src/executors/package/executor.js).

Keep normal PR builds and quality checks. Restore CI artifact uploads for those
builds if useful, but a CI artifact is separate from a GitHub Release asset.
Release publication also needs a retry path that takes an existing tag. Re-running
the release-please job after a failed installer upload can return
`release_created: false` because the release already exists. A manual publishing
dispatch for a verified existing tag avoids that problem.

Installer publication is part of MAE-56. The Release workflow reuses Build for
production tests and packaging, waits for all platforms, and attaches their
installers to the release. App self-updates and signing remain the separate
MAE-58 and MAE-60 work items.

## Verification for implementation

1. Run `make dependency-policy-check` and `make format-check` after adding the
   workflow and config. Validate JSON against the pinned schema and parse the
   workflow YAML. Confirm the generated release PR title passes the existing
   title check.
2. Preview the proposed release against this repository with the pinned
   release-please CLI's dry-run commands. Confirm the first version, changelog
   boundary, exact changed-file list, and that dependency-only commits can
   release under the chosen policy. Do not create a real release as a test.
3. Confirm a version-only change alters hashes for the four Electron targets.
   Build with `pnpm exec nx run maestro-electron:build-app` and check the generated
   manifest and compiled version. Use `make e2e-production` for the packaged app.
4. Check the release PR's frozen pnpm installation and existing CI on all three
   platforms. If adding installer publication, verify assets and retries against
   a test release in a disposable repository.

## Optional Rust synchronization

An independently versioned internal crate needs no release-please changes. If
we choose one version for the application and sidecar, update both
`apps/metadata-engine/Cargo.toml` and its matching `Cargo.lock` package entry in
the release PR. Merely adding these paths as strings is insufficient. Bare
TOML paths target a top-level `version`; Cargo's version is `package.version`.
Bare `.lock` paths use the generic updater, which requires version annotations.
[Extra-file dispatch](https://github.com/googleapis/release-please/blob/v17.6.0/src/strategies/base.ts#L392-L498).

An explicit TOML extra file can target `$.package.version` in `Cargo.toml`.
For `Cargo.lock`, a filtered TOML JSONPath needs care. The bundled parser wraps
TOML values in objects. I verified against this repository's lockfile that
`$.package[?(@.name == "metadata-engine")].version` makes no change, while
`$.package[?(@.name.value == "metadata-engine")].version` changes only the
sidecar entry. This works in v17.6.0 but depends on parser internals, so any
synchronization approach needs a fixture check with the pinned action.
[Generic TOML updater](https://github.com/googleapis/release-please/blob/v17.6.0/src/updaters/generic-toml.ts),
[tagged-value parser](https://github.com/googleapis/release-please/blob/v17.6.0/src/util/toml-edit.ts).

The TOML updater preserves surrounding content through targeted value
replacement, despite a stale source comment claiming that it removes comments.
A separately configured `rust` release has dedicated Cargo manifest and lockfile
updaters, but it also creates its own release version, changelog, and tag. That
is more release machinery than this application needs unless the sidecar will
ship independently.
[Rust strategy](https://github.com/googleapis/release-please/blob/v17.6.0/src/strategies/rust.ts),
[Cargo lock updater](https://github.com/googleapis/release-please/blob/v17.6.0/src/updaters/rust/cargo-lock.ts).

## Implemented release flow

The release-please PR updates `package.json`, `CHANGELOG.md`, and
`.release-please-manifest.json`. The integration sets the root version to
`0.1.0` and starts with an empty manifest. Internal library and crate versions
stay independent.

The new Release workflow starts when the App publishes a GitHub release. It
resolves the tag to its commit, verifies the version and main ancestry, and
calls the shared Build workflow. Each platform runs production E2E and packages
installers. The publishing job waits for all platforms and uploads the files
to that existing release. Manual dispatch accepts an existing tag for retries.

Stable installer names let README links use `releases/latest/download`. Uploads
run outside Nx caching. Release retries replace matching assets and keep the
tag and notes intact.

Release Maestro CI is installed only on `floydnant/release-maestro`. The
repository Actions variable `RELEASE_APP_CLIENT_ID` and secret
`RELEASE_APP_PRIVATE_KEY` are configured. The user generated and stored the
private key.

A local simulation using the exact pinned action bundle confirmed an initial
`0.1.0` PR, patch bumps for both `deps:` and existing `build(deps):` commits,
and no release PR for routine `ci:` commits. The generated
`chore(main): release 0.1.0` title follows the existing PR title convention.

See [releasing.md](../releasing.md) for the maintained operator instructions.

Packaging verification found that the installed nx-electron build executor uses
Nx's `createPackageJson`, which defaults the generated Electron manifest to
`0.0.1` for this integrated workspace. The older nx-electron package-json utility
that copies the root version is unused. The custom Webpack config now sets the
generated manifest's version from root `package.json`. This keeps the installed
app version aligned with the compiled version and release tag.

## Local verification

The seven release-script tests passed. The pinned action simulation confirmed
the initial version and dependency patch bumps. The config matched the pinned
schema, and actionlint accepted the release workflows. Nx's hash inspector
confirmed root version inputs for all four Electron targets and builder config
inputs for both packaging targets.

The production Electron suite passed all 16 tests. The macOS installer build
passed with certificate discovery disabled. Both native and universal packaged
app manifests reported `0.1.0`. Every file referenced by updater metadata
appeared in the asset collection.

The full tools suite passed 175 tests and failed six development-instance cases
under `pnpm exec`. All six passed on a scoped retry with Jest started directly
through Node. The full `make test-tools` command did not pass on this machine. Existing packaging metadata and terminal color warnings
remain.

Formatting passed. Dependency policy passed on a clean export of Git files. The
local checkout's ignored nested worktree contains old policy violations. The
installer rebuild initially exhausted local disk space. Removing this task's
generated outputs and cache entries allowed the final build to pass with Nx
caching disabled.

GitHub CI still needs to verify this change on Linux and Windows. No application
release was created during verification.
