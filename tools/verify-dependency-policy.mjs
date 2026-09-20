import { readFileSync, readdirSync, statSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const dependencySections = ['dependencies', 'devDependencies', 'optionalDependencies']
const ignoredDirectories = new Set(['.git', 'dist', 'node_modules', 'release', 'target'])
const requiredPnpmSettings = [
    'minimumReleaseAge: 4320',
    'minimumReleaseAgeIgnoreMissingTime: false',
    'minimumReleaseAgeStrict: true',
    'trustPolicy: no-downgrade',
    'strictDepBuilds: true',
    'autoInstallPeers: false',
    "savePrefix: ''",
]

export const isExactDependencySpecifier = specifier =>
    /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/.test(specifier)

export const isPinnedActionReference = reference => {
    if (reference.startsWith('./') || reference.startsWith('docker://')) return true
    const separator = reference.lastIndexOf('@')
    return separator > 0 && /^[0-9a-f]{40}$/.test(reference.slice(separator + 1))
}

const findFiles = (directory, predicate) => {
    const files = []
    for (const entry of readdirSync(directory)) {
        if (ignoredDirectories.has(entry)) continue
        const path = join(directory, entry)
        if (statSync(path).isDirectory()) files.push(...findFiles(path, predicate))
        else if (predicate(path)) files.push(path)
    }
    return files
}

export const verifyDependencyPolicy = workspaceRoot => {
    const errors = []
    // Nx installs this integrated monorepo from the root manifest only. Library manifests describe
    // package compatibility, so their wildcard dependencies and peer ranges are intentionally not
    // installation constraints and must not duplicate versions owned by the root lockfile.
    const rootManifest = JSON.parse(readFileSync(join(workspaceRoot, 'package.json'), 'utf8'))

    if (!/^pnpm@\d+\.\d+\.\d+\+sha512\.[0-9a-f]{128}$/.test(rootManifest.packageManager ?? '')) {
        errors.push('package.json: packageManager must pin pnpm by exact version and SHA-512 hash')
    }

    const pnpmSettings = readFileSync(join(workspaceRoot, 'pnpm-workspace.yaml'), 'utf8')
    for (const setting of requiredPnpmSettings) {
        if (!pnpmSettings.split('\n').includes(setting)) {
            errors.push(`pnpm-workspace.yaml: required setting is missing (${setting})`)
        }
    }

    const unsupportedLockfiles = new Set(['package-lock.json', 'npm-shrinkwrap.json', 'yarn.lock'])
    for (const path of findFiles(workspaceRoot, path =>
        unsupportedLockfiles.has(path.slice(path.lastIndexOf('/') + 1)),
    )) {
        errors.push(`${relative(workspaceRoot, path)}: unsupported lockfile`)
    }

    for (const section of dependencySections) {
        for (const [name, specifier] of Object.entries(rootManifest[section] ?? {})) {
            if (!isExactDependencySpecifier(specifier)) {
                errors.push(`package.json: ${section}.${name} is not exact (${specifier})`)
            }
        }
    }

    const githubDirectory = join(workspaceRoot, '.github')
    const workflowFiles = findFiles(githubDirectory, path => /\.ya?ml$/.test(path))
    for (const path of workflowFiles) {
        for (const [index, line] of readFileSync(path, 'utf8').split('\n').entries()) {
            const reference = line.match(/\buses:\s*([^\s#]+)/)?.[1]
            if (reference && !isPinnedActionReference(reference)) {
                errors.push(
                    `${relative(workspaceRoot, path)}:${index + 1}: action is not pinned (${reference})`,
                )
            }
        }
    }

    return errors
}

const scriptPath = fileURLToPath(import.meta.url)
if (resolve(process.argv[1] ?? '') === scriptPath) {
    const errors = verifyDependencyPolicy(resolve(dirname(scriptPath), '..'))
    if (errors.length) {
        console.error(errors.join('\n'))
        process.exitCode = 1
    } else {
        console.log('Dependency policy passed')
    }
}
