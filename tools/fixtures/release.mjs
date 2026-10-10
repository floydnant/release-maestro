import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

export const releaseInstallers = [
    'Release-Maestro-Linux-x86_64.AppImage',
    'Release-Maestro-macOS-universal.dmg',
    'Release-Maestro-macOS-universal.zip',
    'Release-Maestro-Windows-x64.exe',
]

export function createReleaseAssets() {
    const directory = mkdtempSync(join(tmpdir(), 'release-maestro-assets-'))
    for (const name of releaseInstallers) writeFileSync(join(directory, name), 'installer')
    return directory
}

export const publishedRelease = { tagName: 'v0.1.0', isDraft: false, isPrerelease: false }
