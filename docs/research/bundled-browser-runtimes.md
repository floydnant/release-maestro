# Bundled browser runtime review

Review date: November 9, 2026. Tracking issue: [MAE-179](https://linear.app/floyd-haremsa/issue/MAE-179).
The implementation builds on [PR 283](https://github.com/floydnant/release-maestro/pull/283),
revision `c5b65b66c3be73b6c01b56f4f7d724b9c86a8e2a`.
Local binary verification used macOS arm64. CI must verify the proposed head on Linux and Windows too.

## Replacement and executable evidence

| Consumer             | Selection                                                                                     | Observed binary                                                                                                                                                                      |
| -------------------- | --------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Renderer tests       | Playwright 1.65.0 default headless launch                                                     | Chromium headless shell 158.0.8127.18 from `~/Library/Caches/ms-playwright/chromium_headless_shell-1254/chrome-headless-shell-mac-arm64/chrome-headless-shell`                       |
| Full Chromium probe  | Playwright 1.65.0 with `channel: 'chromium'`                                                  | Chromium 158.0.8127.18 from `~/Library/Caches/ms-playwright/chromium-1254/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing`                   |
| Development Electron | Installed Electron package                                                                    | Electron 45.2.3, Chromium 156.0.8078.80, Node 24.22.2 from `node_modules/.pnpm/electron@45.2.3_supports-color@8.1.1/node_modules/electron/dist/Electron.app/Contents/MacOS/Electron` |
| Playwright MCP       | `tools/dev-instance/mcp-wrapper.mjs` supplies `--cdp-endpoint` on the allocated loopback port | CDP `/json/version` reports Chrome/156.0.8078.80 and Electron/45.2.3; MCP evaluates the existing Electron page                                                                       |
| Packaged application | Default host package path                                                                     | `dist/packages/mac-arm64/Release Maestro.app/Contents/MacOS/Release Maestro` reports `app.isPackaged=true`, Electron 45.2.3, Chromium 156.0.8078.80, Node 24.22.2                    |
| Bandcamp hydration   | Native `fetch` plus Cheerio                                                                   | No browser executable. The unused `getBand()` method and bandcamp-fetch dependency are removed                                                                                       |

The Electron process reported its own `process.execPath` and `process.versions` in development
and packaged launches. The packaged app opened its window using a fresh temporary data directory.
Playwright probes recorded each launched child process's executable and the connected browser's version.
The default renderer configuration uses the headless shell. `chromium.executablePath()` alone names
full Chromium and does not identify the executable used by a default headless launch.
Archive inspection found no bandcamp-fetch, Puppeteer, or Playwright files in `app.asar`.
The generated production manifest contains only better-sqlite3, Cheerio, Conf, dotenv, Drizzle,
env-paths, RxJS, tslib, and Zod.

Playwright MCP 0.0.84 pins an older alpha of both Playwright packages.
Two parent-scoped overrides select stable 1.65.0 for both dependencies.
An actual MCP stdio connection initialized, listed the Electron tab, and evaluated its heading
and user agent over CDP. It did not launch the alpha browser.
Remove the overrides when an eligible upstream MCP release selects current browsers itself.
MCP 0.0.85 was available on November 9 but had not passed the three-day package quarantine.

No custom browser path is configured in the repository's MCP wrapper or renderer test config.
The production E2E launcher supports `MAESTRO_E2E_EXECUTABLE_PATH`; development mode ignores it.
A custom path or a different CDP target needs its own binary verification.
Before removal, Puppeteer selected Chrome 148.0.7778.97 under `~/.cache/puppeteer` by default.
That executable was absent locally. No repository caller configured `puppeteerExecutablePath`.
The package's cookie-fetching code could launch a browser, but the application never called it.
Blocking its installation script alone did not establish that it could not run on another machine.
Removing the dependency removes that path and its browser downloader from new packages.

## Upstream security evidence

The [October 27 Chrome advisory](https://chromereleases.googleblog.com/2026/10/stable-channel-update-for-desktop_0562499947.html)
fixes CVE-2026-118306, CVE-2026-118331, CVE-2026-118348, and CVE-2026-118344
in Chromium 156.0.8078.73/.74. The old Playwright declaration, 156.0.8078.4, predates those fixes.
The replacement [Playwright manifest](https://github.com/microsoft/playwright/blob/v1.65.0/packages/playwright-core/browsers.json)
declares Chromium and headless shell 158.0.8127.18. The launched Chromium matches that declaration.
This replaces the old build. It does not certify the absence of vulnerabilities in newer Chromium branches.

[Electron 45.2.3 release notes](https://github.com/electron/electron/releases/tag/v45.2.3)
link [PR 55592](https://github.com/electron/electron/pull/55592), which backports 120 upstream fixes.
The [official release feed](https://releases.electronjs.org/releases.json) identifies its Chromium
as 156.0.8078.80 and Node as 24.22.2. Both launched Electron binaries match those versions.
Its Chromium build is newer than the advisory's fixed patch on the same 156.0.8078 branch.
The current supported Electron patch is therefore the replacement for the old 44.x and 45.2.1 binaries.
The backport PR does not provide a complete CVE mapping for historical Electron 44.x binaries.
Do not infer that an older Chromium major lacks a fix solely from its version number.

The enforcing `make security-runtimes` run reports zero freshness reviews and zero inventory errors.
It inventories all locked versions. Puppeteer absence is valid only when the lockfile no longer contains it;
a missing installation or unreadable manifest for a locked version still fails.
The enforcement modes, upstream feeds, and freshness comparisons are unchanged.

## Verification

- Frozen `make install` completes under the existing supply-chain policy.
- Runtime inventory tests cover removal, missing required runtimes, and missing locked Puppeteer files.
- Bandcamp tests use real localhost HTTP requests for successful hydration, malformed data, and HTTP 429.
  Existing feed hydration tests also pass. Rate limits remain hydration errors without a browser fallback.
- The Chromium feed playback scenarios pass with Playwright 1.65.0.
- Production packaging rebuilds better-sqlite3 for Electron 45.2.3. Packaged Electron tests exercise
  database migrations, scans, persistence, and file-URL renderer loading.
- `make security` removes the two extract-zip findings but still fails on the unrelated deepmerge
  advisory GHSA-gcqx-w48m-w2h4. No exception accepts that finding. Release gates remain blocked.

## Historical installers and unresolved disposition

GitHub releases and tags returned no entries during this review. That does not establish that no
binaries reached users. The successful [main build 42266059459](https://github.com/floydnant/release-maestro/actions/runs/42266059459)
produced installers from revision `f81573a2dd32dbd2b0afb8ccdd37ce18a8c9ce4d`:

- macOS installer artifact `13528255177`.
- Windows installer artifact `13527980186`.
- Linux installer artifact `13526718624`.
- macOS release SBOM artifact `13527073015`.

The downloaded SBOM provenance identifies the same revision, darwin arm64, and `dist/executables`.
Its runtime dependency graph includes Electron 45.2.1, bandcamp-fetch 3.2.1, and Puppeteer Core 24.43.1.
The artifact SBOM identifies Release Maestro 0.1.0 but does not attest its embedded browser version.
These are affected build candidates, not proof that Puppeteer's browser shipped or executed.
External distribution records, installed copies, and older installer binaries were unavailable.

Keep these findings open under MAE-179 after the code change merges:

| Finding                                           | Owner         | Decision deadline | Evidence needed to close                                                                                                                  |
| ------------------------------------------------- | ------------- | ----------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| Historical installer distribution and replacement | Floyd Haremsa | November 12, 2026 | Identify distributed builds and installed versions; replace or withdraw affected binaries and record the disposition                      |
| Historical Electron 44.x advisory applicability   | Floyd Haremsa | November 12, 2026 | Obtain old binaries and upstream backport mappings, or document replacement of all distributed copies without asserting CVE applicability |
| Replacement coverage on supported platforms       | Floyd Haremsa | November 12, 2026 | Green CI on the fixed head and disposition of previous installers; local arm64 evidence covers only this host                             |

Unknown applicability remains actionable. A clean freshness result does not close historical exposure
or the separate advisory investigation. Renderer isolation and IPC hardening stay in MAE-167.
