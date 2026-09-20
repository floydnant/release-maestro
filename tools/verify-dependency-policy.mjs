import { readFileSync, readdirSync, lstatSync } from 'node:fs'
import { basename, dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parse } from 'yaml'

const dependencySections = ['dependencies', 'devDependencies', 'optionalDependencies']
const ignoredDirectories = new Set([
    '.angular',
    '.corepack',
    '.git',
    '.nx',
    'coverage',
    'dist',
    'node_modules',
    'playwright-report',
    'release',
    'target',
    'test-results',
])
const requiredPnpmSettings = new Map([
    ['minimumReleaseAge', 4320],
    ['minimumReleaseAgeIgnoreMissingTime', false],
    ['minimumReleaseAgeStrict', true],
    ['trustPolicy', 'no-downgrade'],
    ['strictDepBuilds', true],
    ['autoInstallPeers', false],
    ['savePrefix', ''],
])

export const isExactDependencySpecifier = specifier =>
    /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/.test(specifier)

export const isPinnedActionReference = reference => {
    if (reference.startsWith('./')) return true
    if (/^docker:\/\/.+@sha256:[0-9a-f]{64}$/.test(reference)) return true
    const separator = reference.lastIndexOf('@')
    return separator > 0 && /^[0-9a-f]{40}$/.test(reference.slice(separator + 1))
}

const findFiles = (directory, predicate) => {
    const files = []
    for (const entry of readdirSync(directory)) {
        if (ignoredDirectories.has(entry)) continue
        const path = join(directory, entry)
        const metadata = lstatSync(path)
        if (metadata.isSymbolicLink()) {
            if (predicate(path)) files.push(path)
            continue
        }
        if (metadata.isDirectory()) files.push(...findFiles(path, predicate))
        else if (predicate(path)) files.push(path)
    }
    return files
}

const collectStepReferences = steps => {
    if (!Array.isArray(steps)) return []
    return steps.flatMap(step =>
        step !== null && typeof step === 'object' && Object.hasOwn(step, 'uses') ? [step.uses] : [],
    )
}

const collectActionReferences = document => {
    if (document === null || typeof document !== 'object') return []

    const jobReferences = Object.values(document.jobs ?? {}).flatMap(job => {
        if (job === null || typeof job !== 'object') return []
        return [...(Object.hasOwn(job, 'uses') ? [job.uses] : []), ...collectStepReferences(job.steps)]
    })
    return [...jobReferences, ...collectStepReferences(document.runs?.steps)]
}

const readYaml = (path, workspaceRoot, errors) => {
    try {
        return parse(readFileSync(path, 'utf8'))
    } catch (error) {
        errors.push(
            `${relative(workspaceRoot, path)}: invalid YAML (${error instanceof Error ? error.message : String(error)})`,
        )
        return undefined
    }
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
    if (rootManifest.engines?.node !== '>= 22.22.3 < 25') {
        errors.push('package.json: engines.node must require Node 22.22.3 through Node 24')
    }

    const pnpmSettingsPath = join(workspaceRoot, 'pnpm-workspace.yaml')
    const pnpmSettings = readYaml(pnpmSettingsPath, workspaceRoot, errors)
    for (const [setting, requiredValue] of requiredPnpmSettings) {
        if (pnpmSettings?.[setting] !== requiredValue) {
            errors.push(`pnpm-workspace.yaml: ${setting} must be ${JSON.stringify(requiredValue)}`)
        }
    }

    const unsupportedLockfiles = new Set(['package-lock.json', 'npm-shrinkwrap.json', 'yarn.lock'])
    for (const path of findFiles(workspaceRoot, path => unsupportedLockfiles.has(basename(path)))) {
        errors.push(`${relative(workspaceRoot, path)}: unsupported lockfile`)
    }

    for (const section of dependencySections) {
        for (const [name, specifier] of Object.entries(rootManifest[section] ?? {})) {
            if (!isExactDependencySpecifier(specifier)) {
                errors.push(`package.json: ${section}.${name} is not exact (${specifier})`)
            }
        }
    }

    const workflowFiles = findFiles(join(workspaceRoot, '.github', 'workflows'), path =>
        /\.ya?ml$/.test(path),
    )
    const actionFiles = findFiles(workspaceRoot, path => /^action\.ya?ml$/.test(basename(path)))
    const automationFiles = new Set([...workflowFiles, ...actionFiles])
    for (const path of automationFiles) {
        const document = readYaml(path, workspaceRoot, errors)
        for (const reference of collectActionReferences(document)) {
            if (typeof reference !== 'string' || !isPinnedActionReference(reference)) {
                errors.push(`${relative(workspaceRoot, path)}: action is not pinned (${String(reference)})`)
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
