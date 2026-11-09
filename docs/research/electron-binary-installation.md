# Electron binary installation

Research for PR 283, checked 2026-11-09 against `electron` 45.2.3.

Commit `92f3543` added `pnpm exec install-electron` in three places: the root `postinstall`, `make install`,
and the shared `.github/actions/setup-node` action. Those steps were added after local installs failed
with HTTP 504. This note checks that change against Electron's design and recommends a smaller one.

## Recommendation

Remove all three prefetches. Electron 45 downloads its binary on first use, so none of them is needed
for correctness. Keep `electron-builder install-app-deps` in `postinstall`.

If you want one explicit step, keep only the `make install` line, documented as warming a
full development checkout. Don't put the prefetch back in the shared CI action. Formatting, lint, and security scans do not need the Electron runtime. Database checks use the
Electron CLI and trigger its download on demand. Development Electron E2E does the same through
Playwright. Production E2E uses the executable produced by electron-builder. A
CI job that needs a hard error before tests run should call `pnpm exec install-electron --no`
itself. A shared action shouldn't add that step to every job.

The 504 was a network failure while fetching from GitHub Releases. The binary wasn't
missing because of a regression. A prefetch makes the same request through the same
[`@electron/get`](https://github.com/electron/get) path, so it moves that failure to install time
and makes `pnpm install` fail when GitHub is unavailable. Electron's documentation suggests a mirror or a
pre-populated cache for unreliable networks
([installation: custom mirrors and caches](https://www.electronjs.org/docs/latest/tutorial/installation#custom-mirrors-and-caches)).

## What changed upstream, and when

- [RFC #22](https://github.com/electron/rfcs/pull/22), merged 2026-02-23, proposes removing the
  `postinstall` script and downloading the binary the first time Electron runs.
- [electron#49328](https://github.com/electron/electron/pull/49328) ("feat: lazy electron download",
  semver/major) implemented it on 2026-02-20. The
  [breaking-changes document](https://github.com/electron/electron/blob/main/docs/breaking-changes.md#behavior-changed-electron-no-longer-downloads-itself-via-postinstall-script)
  lists it under **Electron 42.0**. Electron 42 also dropped `ELECTRON_SKIP_BINARY_DOWNLOAD`.
- [electron#50359](https://github.com/electron/electron/pull/50359), merged 2026-03-20 and labeled
  `semver/patch` and `merged/42-x-y`, is only a docs change. It removed the tutorial warning that the
  `postinstall` script must be allowed to run, "because they are redundant as of electron v42".

The behavior first shipped in v42. No v45 patch release introduced it.

## Security motivation

The RFC says `postinstall` scripts are "a known attack vector" and that the lazy download lets users
disable them without workarounds. Its stated benefit is smaller supply-chain attack surface
during installation
([RFC motivation](https://github.com/electron/rfcs/pull/22)). The breaking-changes entry gives the
same reason: recent npm supply-chain attacks used `postinstall` scripts.

The change doesn't do more than that. The same `install.js` still runs, with the same download and
the same checksum check against the bundled `checksums.json`. It just runs later. The breaking-changes
entry says `install-electron` "contains the exact same code from the former `postinstall` script".
Lazy download doesn't make running Electron any safer. It only removes one reason to allow
install-time scripts. A root `postinstall` that calls `install-electron` brings back the install-time
download the RFC removed.

## What "explicit prefetch" is for

The RFC adds `install-electron` for "edge cases requiring immediate download", such as custom build
scripts or Docker layers that need the binary right after install. It suggests a user `postinstall`
only for projects that want the old behavior. The
[installation guide](https://www.electronjs.org/docs/latest/tutorial/installation) says the binary
downloads "the first time you run Electron" and calls `npx install-electron --no` the on-demand
option. Upstream treats prefetch as optional and something each project chooses, not a default.

## Local behavior

- `node_modules/electron/index.js` runs `install.js` whenever `path.txt` or the executable is missing.
  That covers `require('electron')` as well as the CLI. `pnpm exec electron` (`db-truncate-library`)
  and Playwright's `_electron.launch` without `executablePath` (`apps/maestro-e2e`) therefore download
  the binary on first use.
- `install.js` exits right away when the installed version and path match, so repeat prefetches cost
  little. They still add one more place where downloads can fail.
- Jest specs mock `electron` (`main.spec.ts`, `app-env.spec.ts` uses `jest.doMock`), so unit jobs don't
  load the real module. If a spec ever imports the real module, it downloads the binary when it runs.
- `pnpm-workspace.yaml` still lists `electron: true` under `allowBuilds`. Electron 45 ships no
  lifecycle script, so that entry has no effect. Removing it is a separate cleanup.

## Risks of removing the prefetch

- Download errors move from install time to the first launch, an RFC drawback the authors accepted.
  The `index.js` error message tells users to run `npx install-electron --no`.
- Both Electron E2E configurations use one worker in CI. Local runs use two and could attempt
  simultaneous first-use downloads. This is an unverified upstream risk, not evidence for a shared
  prefetch. A demonstrated failure would justify preparation in that consumer alone.
- The cleanup removes the README promise that repeat installs ensure the binary is present.
  First use requires network access or a populated download cache.
