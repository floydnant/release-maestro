import { execFileSync, spawnSync } from 'node:child_process'
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseAllDocuments } from 'yaml'
import { installTool, sha256 } from './install.mjs'
import { evaluateScan, validateExceptions } from './policy.mjs'
import { cargoRuntimePackages, npmRuntimePackages, scopeSbom } from './sbom.mjs'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const output = join(root, 'dist/security')
const readJson = path => JSON.parse(readFileSync(path, 'utf8'))
const writeJson = (path, value) => writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`)
const exceptions = () => readJson(join(root, 'tools/security/exceptions.json'))

const security = async () => {
    mkdirSync(output, { recursive: true })
    for (const file of ['osv.json', 'findings.json']) rmSync(join(output, file), { force: true })
    const accepted = exceptions()
    validateExceptions(accepted)
    const tool = await installTool('osv-scanner', root)
    const reportPath = join(output, 'osv.json')
    try {
        const result = spawnSync(
            tool.path,
            [
                'scan',
                'source',
                '--no-call-analysis',
                '--no-resolve',
                '--all-packages',
                '--all-vulns',
                '--config',
                'tools/security/osv-scanner.toml',
                '--format',
                'json',
                '--output-file',
                reportPath,
                '--lockfile',
                'pnpm-lock.yaml',
                '--lockfile',
                'apps/metadata-engine/Cargo.lock',
            ],
            { cwd: root, stdio: 'inherit' },
        )
        if (result.error) throw result.error
        if (![0, 1].includes(result.status))
            throw new Error(`OSV scan failed: exit ${result.status}, signal ${result.signal}`)
        const findings = evaluateScan(readJson(reportPath), accepted)
        writeJson(join(output, 'findings.json'), findings)
        for (const finding of findings) {
            console.log(
                `${finding.status.toUpperCase()} ${finding.ecosystem} ${finding.name}@${finding.version} ${finding.id}: ${finding.summary}${finding.expires ? ` (expires ${finding.expires})` : ''}`,
            )
        }
        const blocked = findings.filter(finding => finding.status === 'blocked')
        console.log(
            `Security scan: ${blocked.length} blocking, ${findings.filter(f => f.status === 'accepted').length} accepted, ${findings.filter(f => f.status === 'informational').length} informational`,
        )
        if (blocked.length) process.exitCode = 1
    } finally {
        tool.cleanup()
    }
}

const sbom = async artifactDirectory => {
    // Only stage authoritative inputs. Installed modules and previous build outputs cannot pollute the source inventory.
    const tool = await installTool('syft', root)
    const stage = mkdtempSync(join(tmpdir(), 'maestro-sbom-'))
    mkdirSync(output, { recursive: true })
    try {
        for (const file of [
            'repository.cdx.json',
            'runtime.cdx.json',
            'artifact.cdx.json',
            'provenance.json',
        ]) {
            rmSync(join(output, file), { force: true })
        }
        for (const file of [
            'package.json',
            'pnpm-lock.yaml',
            'apps/metadata-engine/Cargo.toml',
            'apps/metadata-engine/Cargo.lock',
        ]) {
            const destination = join(stage, file)
            mkdirSync(dirname(destination), { recursive: true })
            cpSync(join(root, file), destination)
        }
        const manifest = readJson(join(root, 'package.json'))
        const runSyft = (source, destination, name) =>
            execFileSync(
                tool.path,
                [
                    'scan',
                    `dir:${source}`,
                    '--source-name',
                    name,
                    '--source-version',
                    manifest.version,
                    '-o',
                    `cyclonedx-json@1.6=${destination}`,
                ],
                { cwd: stage, stdio: 'inherit' },
            )
        const generated = join(stage, 'source.cdx.json')
        runSyft(stage, generated, 'release-maestro-source')
        const lock = parseAllDocuments(readFileSync(join(root, 'pnpm-lock.yaml'), 'utf8')).map(document => {
            if (document.errors.length) throw document.errors[0]
            return document.toJS()
        })
        const metadata = JSON.parse(
            execFileSync(
                'cargo',
                [
                    'metadata',
                    '--locked',
                    '--offline',
                    '--format-version',
                    '1',
                    '--manifest-path',
                    'apps/metadata-engine/Cargo.toml',
                ],
                { cwd: root, encoding: 'utf8', maxBuffer: 10 * 1024 * 1024 },
            ),
        )
        const { repository, runtime } = scopeSbom(
            readJson(generated),
            npmRuntimePackages(lock, ['@ngx-translate/core', '@ngx-translate/http-loader']),
            cargoRuntimePackages(metadata),
            manifest.devDependencies.electron,
        )
        // Check that the cataloger has not silently omitted either language or the Electron runtime.
        for (const name of ['electron', '@angular/core', 'better-sqlite3', 'lofty']) {
            if (!runtime.components.some(component => component.name === name))
                throw new Error(`SBOM omitted ${name}`)
        }
        writeJson(join(output, 'repository.cdx.json'), repository)
        writeJson(join(output, 'runtime.cdx.json'), runtime)
        const provenance = {
            revision: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(),
            platform: process.platform,
            architecture: process.arch,
            inputs: Object.fromEntries(
                [
                    'package.json',
                    'pnpm-lock.yaml',
                    'apps/metadata-engine/Cargo.toml',
                    'apps/metadata-engine/Cargo.lock',
                ].map(file => [file, sha256(readFileSync(join(root, file)))]),
            ),
        }
        if (artifactDirectory) {
            const path = resolve(root, artifactDirectory)
            if (!statSync(path).isDirectory()) throw new Error(`Not a packaged artifact directory: ${path}`)
            runSyft(path, join(output, 'artifact.cdx.json'), 'release-maestro-package')
            provenance.artifactDirectory = artifactDirectory
        }
        writeJson(join(output, 'provenance.json'), provenance)
        console.log(
            `SBOMs written to dist/security: ${repository.components.length} repository components, ${runtime.components.length} runtime components`,
        )
    } finally {
        tool.cleanup()
        rmSync(stage, { recursive: true, force: true })
    }
}

try {
    switch (process.argv[2]) {
        case 'scan':
            await security()
            break
        case 'sbom':
            await sbom(process.argv[3])
            break
        case 'policy':
            validateExceptions(exceptions())
            console.log('Security exception policy passed')
            break
        case 'install':
            for (const name of ['osv-scanner', 'syft']) (await installTool(name, root)).cleanup()
            break
        default:
            throw new Error('Usage: security/cli.mjs scan|sbom [artifact-directory]|policy|install')
    }
} catch (error) {
    console.error(error instanceof Error ? error.message : String(error))
    process.exitCode = 1
}
