// Platform-aware release build for the `metadata-engine` worker binary.
//
// On macOS the packaged app is built as a single `universal` Electron app
// (see electron-builder.json `mac.target.arch`), which @electron/universal
// produces by merging an x64 and an arm64 sub-build. Every shipped binary must
// therefore run on both architectures, so here we build both Rust targets and
// `lipo` them into a single universal2 binary at the canonical release path.
//
// On every other platform a plain host-arch release build is correct (CI builds
// the Windows binary on Windows, the Linux binary on Linux, etc.).
import { execFileSync } from 'node:child_process'
import { mkdirSync } from 'node:fs'
import { platform } from 'node:os'

const run = (command, args) => execFileSync(command, args, { stdio: 'inherit' })

const OUTPUT = 'target/release/metadata-engine'

if (platform() === 'darwin') {
    const targets = ['aarch64-apple-darwin', 'x86_64-apple-darwin']

    run('rustup', ['target', 'add', ...targets])
    for (const target of targets) {
        run('cargo', ['build', '--release', '--target', target])
    }

    mkdirSync('target/release', { recursive: true })
    run('lipo', [
        '-create',
        ...targets.map(target => `target/${target}/release/metadata-engine`),
        '-output',
        OUTPUT,
    ])
} else {
    run('cargo', ['build', '--release'])
}
