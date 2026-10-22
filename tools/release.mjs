import { execFileSync } from 'node:child_process'
import { appendFileSync, copyFileSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync } from 'node:fs'
import { basename, join } from 'node:path'
import { pathToFileURL } from 'node:url'

export const installerNames = {
    linux: ['Release-Maestro-Linux-x86_64.AppImage'],
    macos: ['Release-Maestro-macOS-universal.dmg', 'Release-Maestro-macOS-universal.zip'],
    windows: ['Release-Maestro-Windows-x64.exe'],
}

export function releaseVersion(tag) {
    if (typeof tag !== 'string' || !/^v(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)$/.test(tag)) {
        throw new Error('Expected a stable release tag such as v0.1.0')
    }
    return tag.slice(1)
}

export function verifyVersion(tag, version) {
    const expected = releaseVersion(tag)
    if (version !== expected) throw new Error(`Release ${tag} does not match package.json version ${version}`)
}

export function verifyPublishedRelease(tag, release) {
    releaseVersion(tag)
    if (
        release === null ||
        typeof release !== 'object' ||
        release.tagName !== tag ||
        release.isDraft !== false ||
        release.isPrerelease !== false
    ) {
        throw new Error(`Expected an existing published stable release for ${tag}`)
    }
}

export function collectAssets(directory, platform) {
    const expected = platform === 'all' ? Object.values(installerNames).flat() : installerNames[platform]
    if (!expected) throw new Error(`Unknown release platform: ${platform}`)
    const files = readdirSync(directory, { withFileTypes: true })
        .filter(entry => entry.isFile())
        .map(entry => entry.name)
    const installers = files.filter(
        name =>
            expected.includes(name) ||
            ((platform === 'macos' || platform === 'all') &&
                /^Release-Maestro-macOS-(?:arm64|x64)\.(?:dmg|zip)$/.test(name)),
    )
    for (const name of [...expected, ...installers]) {
        if (!files.includes(name) || statSync(join(directory, name)).size === 0) {
            throw new Error(`Missing or empty installer: ${name}`)
        }
    }
    // Keep updater metadata and blockmaps with the installers, without uploading unpacked apps.
    return files
        .filter(
            name =>
                installers.includes(name) ||
                installers.some(installer => name === `${installer}.blockmap`) ||
                /^latest(?:-mac|-linux)?\.yml$/.test(name),
        )
        .sort()
        .map(name => join(directory, name))
}

const run = (command, args) => execFileSync(command, args, { encoding: 'utf8' }).trim()

export function resolveRelease(tag, repository, command = run) {
    releaseVersion(tag)
    const release = JSON.parse(
        command('gh', [
            'release',
            'view',
            tag,
            '--repo',
            repository,
            '--json',
            'tagName,isDraft,isPrerelease',
        ]),
    )
    verifyPublishedRelease(tag, release)
    command('git', ['fetch', '--no-tags', 'origin', `refs/tags/${tag}:refs/tags/${tag}`])
    const sha = command('git', ['rev-parse', `${tag}^{commit}`])
    command('git', ['merge-base', '--is-ancestor', sha, 'origin/main'])
    const manifest = JSON.parse(command('git', ['show', `${sha}:package.json`]))
    verifyVersion(tag, manifest.version)
    return { tag, sha }
}

export function uploadRelease(tag, repository, directory, version, command = run) {
    verifyVersion(tag, version)
    const release = JSON.parse(
        command('gh', [
            'release',
            'view',
            tag,
            '--repo',
            repository,
            '--json',
            'tagName,isDraft,isPrerelease',
        ]),
    )
    verifyPublishedRelease(tag, release)
    const files = collectAssets(directory, 'all')
    command('gh', ['release', 'upload', tag, ...files, '--repo', repository, '--clobber'])
}

function main() {
    const [operation] = process.argv.slice(2)
    const tag = process.env.RELEASE_TAG
    const directory = join(process.env.RUNNER_TEMP ?? '.', 'release-assets')
    switch (operation) {
        case 'resolve': {
            const release = resolveRelease(tag, process.env.GITHUB_REPOSITORY)
            appendFileSync(process.env.GITHUB_OUTPUT, `tag=${release.tag}\nsha=${release.sha}\n`)
            break
        }
        case 'verify':
            verifyVersion(tag, JSON.parse(readFileSync('package.json', 'utf8')).version)
            break
        case 'stage': {
            const files = collectAssets('dist/executables', process.env.RELEASE_PLATFORM)
            rmSync(directory, { force: true, recursive: true })
            mkdirSync(directory, { recursive: true })
            for (const file of files) copyFileSync(file, join(directory, basename(file)))
            break
        }
        case 'upload':
            uploadRelease(
                tag,
                process.env.GITHUB_REPOSITORY,
                directory,
                JSON.parse(readFileSync('package.json', 'utf8')).version,
            )
            break
        default:
            throw new Error('Usage: node tools/release.mjs resolve|verify|stage|upload')
    }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main()
