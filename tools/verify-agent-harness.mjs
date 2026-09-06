#!/usr/bin/env node

// Purpose: Validate the canonical agent-skill tree and its harness adapters offline.
//
// Source of truth is .agents/skills/<name>/SKILL.md. Harness directories hold adapters only:
// a relative symlink per skill, unless the skill is declared divergent in
// .agents/harness-overrides.json. Install the isolated tools dependencies with npm ci --prefix tools.

import { existsSync, lstatSync, readFileSync, readdirSync, readlinkSync, statSync } from 'node:fs'
import { dirname, isAbsolute, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { parseDocument } from 'yaml'

const repoRoot = resolve(process.argv[2] ?? resolve(dirname(fileURLToPath(import.meta.url)), '..'))
const canonicalDir = join(repoRoot, '.agents', 'skills')
const manifestPath = join(repoRoot, '.agents', 'harness-overrides.json')

let checks = 0
let failures = 0

const rel = path => relative(repoRoot, path)

function pass(message) {
    checks += 1
    process.stdout.write(`ok - ${message}\n`)
}

function fail(message) {
    checks += 1
    failures += 1
    process.stderr.write(`not ok - ${message}\n`)
}

function assert(condition, okMessage, failMessage) {
    if (condition) pass(okMessage)
    else fail(failMessage)
    return condition
}

// YAML 1.2 treats yes/no as strings. Reject them for boolean policy fields.
const isRecord = value => value !== null && typeof value === 'object' && !Array.isArray(value)

function readYaml(text, file) {
    try {
        const document = parseDocument(text)
        const problems = [...document.errors, ...document.warnings]
        if (problems.length) throw new Error(problems.map(problem => problem.message).join('; '))
        const data = document.toJS()
        if (!isRecord(data)) throw new Error('expected a YAML mapping')
        return data
    } catch (error) {
        fail(`${rel(file)} has invalid YAML: ${error.message}`)
        return null
    }
}

function validateSkill(skillFile, name) {
    const label = rel(skillFile)
    if (
        !assert(
            existsSync(skillFile) && statSync(skillFile).isFile(),
            `${label} exists`,
            `${label} must be a file`,
        )
    )
        return null
    const lines = readFileSync(skillFile, 'utf8').split(/\r?\n/)
    const end = lines.indexOf('---', 1)
    if (
        !assert(
            lines[0] === '---' && end > 0,
            `${label} has complete YAML frontmatter`,
            `${label} must open and close its frontmatter with ---`,
        )
    )
        return null
    const data = readYaml(lines.slice(1, end).join('\n'), skillFile)
    if (!data) return null
    assert(
        data.name === name,
        `${label} name matches its directory`,
        `${label} declares name '${data.name ?? ''}' but sits in '${name}'`,
    )
    assert(
        typeof data.description === 'string' &&
            data.description.trim().length > 0 &&
            data.description.length <= 1024,
        `${label} has a description`,
        `${label} needs a description of 1 to 1024 characters`,
    )
    assert(
        data['disable-model-invocation'] === undefined ||
            typeof data['disable-model-invocation'] === 'boolean',
        `${label} has a boolean invocation flag`,
        `${label} disable-model-invocation must be a YAML boolean, true or false`,
    )
    return data
}

// --- Manifest --------------------------------------------------------------------------------

let manifest = { harnesses: {} }
if (assert(existsSync(manifestPath), `${rel(manifestPath)} exists`, `${rel(manifestPath)} is missing`)) {
    try {
        manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
        pass(`${rel(manifestPath)} is valid JSON`)
    } catch (error) {
        fail(`${rel(manifestPath)} is not valid JSON: ${error.message}`)
    }
}

const harnesses = []
if (
    assert(
        isRecord(manifest) && isRecord(manifest.harnesses) && Object.keys(manifest.harnesses).length > 0,
        'manifest declares harnesses',
        `${rel(manifestPath)} needs a non-empty harnesses object`,
    )
) {
    for (const [id, config] of Object.entries(manifest.harnesses)) {
        const valid =
            isRecord(config) &&
            typeof config.skillsDir === 'string' &&
            config.skillsDir.trim().length > 0 &&
            !isAbsolute(config.skillsDir) &&
            !relative(repoRoot, resolve(repoRoot, config.skillsDir)).startsWith('..') &&
            (config.diverge === undefined ||
                (Array.isArray(config.diverge) && config.diverge.every(name => typeof name === 'string')))
        if (
            assert(
                valid,
                `${id} has valid configuration`,
                `${rel(manifestPath)} harness '${id}' needs a repository-relative skillsDir and an optional array of divergence names`,
            )
        ) {
            harnesses.push({ id, skillsDir: config.skillsDir, diverge: new Set(config.diverge ?? []) })
        }
    }
}

// --- Canonical skills ------------------------------------------------------------------------

const skillNames = existsSync(canonicalDir)
    ? readdirSync(canonicalDir, { withFileTypes: true })
          .filter(entry => entry.isDirectory())
          .map(entry => entry.name)
          .sort()
    : []

assert(skillNames.length > 0, 'at least one canonical skill exists', 'no skills found under .agents/skills')

for (const name of skillNames) {
    const skillDir = join(canonicalDir, name)
    const skillFile = join(skillDir, 'SKILL.md')
    const label = rel(skillFile)

    if (!assert(existsSync(skillFile), `${label} exists`, `${rel(skillDir)} has no SKILL.md`)) continue

    assert(
        /^[a-z0-9]+(-[a-z0-9]+)*$/.test(name),
        `${label} has a kebab-case directory name`,
        `${rel(skillDir)} must be lowercase kebab-case`,
    )

    const frontmatter = validateSkill(skillFile, name)
    if (!frontmatter) continue

    // --- openai.yaml sidecar ---
    const sidecar = join(skillDir, 'agents', 'openai.yaml')
    const sidecarLabel = rel(sidecar)
    if (
        !assert(
            existsSync(sidecar) && statSync(sidecar).isFile(),
            `${sidecarLabel} exists`,
            `${rel(skillDir)} needs agents/openai.yaml as a file`,
        )
    )
        continue

    const sidecarData = readYaml(readFileSync(sidecar, 'utf8'), sidecar)
    if (!sidecarData) continue
    const iface = sidecarData.interface ?? {}
    assert(
        typeof iface.display_name === 'string' && iface.display_name.length > 0,
        `${sidecarLabel} declares a display_name`,
        `${sidecarLabel} needs interface.display_name`,
    )
    assert(
        typeof iface.short_description === 'string' && iface.short_description.length > 0,
        `${sidecarLabel} declares a short_description`,
        `${sidecarLabel} needs interface.short_description`,
    )

    const declared = (sidecarData.policy ?? {}).allow_implicit_invocation
    if (
        assert(
            typeof declared === 'boolean',
            `${sidecarLabel} declares allow_implicit_invocation`,
            `${sidecarLabel} needs policy.allow_implicit_invocation set to true or false`,
        )
    ) {
        const modelInvocable = frontmatter['disable-model-invocation'] !== true
        assert(
            declared === modelInvocable,
            `${sidecarLabel} invocation policy matches SKILL.md`,
            `${sidecarLabel} says allow_implicit_invocation: ${declared} but ${label} says disable-model-invocation: ${frontmatter['disable-model-invocation'] ?? 'false'}`,
        )
    }
}

// --- Harness adapters, both directions --------------------------------------------------------

const canonicalNames = new Set(skillNames)
const divergentDirs = []

for (const harness of harnesses) {
    const adapterRoot = join(repoRoot, harness.skillsDir)

    for (const name of harness.diverge) {
        assert(
            canonicalNames.has(name),
            `${harness.id} divergence '${name}' names a real skill`,
            `${rel(manifestPath)} lists '${name}' as a ${harness.id} divergence but .agents/skills/${name} does not exist`,
        )
    }

    if (
        !assert(
            existsSync(adapterRoot) && statSync(adapterRoot).isDirectory(),
            `${harness.skillsDir} is a directory`,
            `${harness.skillsDir} must be a real directory, not a symlink to the canonical tree`,
        )
    )
        continue

    assert(
        !lstatSync(adapterRoot).isSymbolicLink(),
        `${harness.skillsDir} is not a parent-directory symlink`,
        `${harness.skillsDir} must hold one link per skill, not a symlink to .agents/skills`,
    )

    // Canonical -> adapter
    for (const name of skillNames) {
        const adapter = join(adapterRoot, name)
        const adapterLabel = `${harness.skillsDir}/${name}`
        const expected = relative(adapterRoot, join(canonicalDir, name))

        if (harness.diverge.has(name)) {
            const isRealDir =
                existsSync(adapter) && !lstatSync(adapter).isSymbolicLink() && statSync(adapter).isDirectory()
            assert(
                isRealDir && existsSync(join(adapter, 'SKILL.md')),
                `${adapterLabel} is a declared divergence with its own SKILL.md`,
                `${adapterLabel} is declared divergent, so it must be a real directory containing SKILL.md`,
            )
            if (isRealDir) {
                validateSkill(join(adapter, 'SKILL.md'), name)
                divergentDirs.push(adapter)
            }
            continue
        }

        const isLink = existsSync(join(adapterRoot, name)) || lstatSync(adapter, { throwIfNoEntry: false })
        assert(
            isLink &&
                lstatSync(adapter, { throwIfNoEntry: false })?.isSymbolicLink() &&
                readlinkSync(adapter) === expected,
            `${adapterLabel} links to the canonical skill`,
            `${adapterLabel} must be a symlink to ${expected} (or be declared in ${rel(manifestPath)})`,
        )
    }

    // Adapter -> canonical
    for (const entry of readdirSync(adapterRoot).filter(name => !['.DS_Store', 'Thumbs.db'].includes(name))) {
        assert(
            canonicalNames.has(entry),
            `${harness.skillsDir}/${entry} has a canonical source`,
            `${harness.skillsDir}/${entry} has no .agents/skills/${entry} behind it — stale adapter`,
        )
    }

    // No copied skill content
    for (const entry of readdirSync(adapterRoot).filter(name => !['.DS_Store', 'Thumbs.db'].includes(name))) {
        if (harness.diverge.has(entry)) continue
        const adapter = join(adapterRoot, entry)
        const link = lstatSync(adapter, { throwIfNoEntry: false })
        if (link?.isSymbolicLink()) continue
        assert(
            !existsSync(join(adapter, 'SKILL.md')),
            `${harness.skillsDir}/${entry} does not duplicate skill content`,
            `${harness.skillsDir}/${entry}/SKILL.md is a copy — skill content belongs in .agents/skills`,
        )
    }
}

// --- Cross-reference links ---------------------------------------------------------------------
// A markdown link inside a skill is a reference and has to resolve, relative to the file that names
// it or from the repository root. A backticked path is ambiguous: skills routinely name files they
// will create (`MISSION.md`, `NOTES.md`), so one is only treated as a reference when it sits in a
// subdirectory that already exists beside the file (`references/reviewer.md`). Globs and
// `<placeholder>` segments are patterns, not paths.

function markdownFiles(dir) {
    return readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
        const path = join(dir, entry.name)
        if (entry.isDirectory()) return markdownFiles(path)
        return entry.isFile() && entry.name.endsWith('.md') ? [path] : []
    })
}

const referencePattern = /\]\(([^)\s]+)\)|`([^`\s]+\.(?:md|sh|tsv|ts|json|yaml))`/g
let brokenReferences = 0
let checkedReferences = 0

const referenceFiles = [
    ...(skillNames.length ? markdownFiles(canonicalDir) : []),
    ...divergentDirs.flatMap(markdownFiles),
]
for (const file of referenceFiles) {
    const text = readFileSync(file, 'utf8')
    for (const match of text.matchAll(referencePattern)) {
        const isMarkdownLink = match[1] !== undefined
        const raw = match[1] ?? match[2]
        if (/^(https?:|mailto:|#)/.test(raw)) continue

        const target = raw.split('#')[0]
        if (!target || !/\.[a-z]+$/.test(target)) continue
        if (/[*<>]/.test(target)) continue

        if (!isMarkdownLink) {
            const parent = dirname(target)
            if (parent === '.' || !existsSync(resolve(dirname(file), parent))) continue
        }

        checkedReferences += 1
        const fromFile = resolve(dirname(file), target)
        const fromRoot = resolve(repoRoot, target)
        if (!existsSync(fromFile) && !existsSync(fromRoot)) {
            brokenReferences += 1
            fail(`${rel(file)} references '${raw}', which does not resolve`)
        }
    }
}

assert(
    brokenReferences === 0,
    `all ${checkedReferences} cross-references in canonical and divergent skills resolve`,
    `${brokenReferences} of ${checkedReferences} cross-references in canonical and divergent skills do not resolve`,
)

// --- Summary -------------------------------------------------------------------------------------

if (failures > 0) {
    process.stderr.write(`\n${failures} of ${checks} agent harness checks failed.\n`)
    process.exit(1)
}

process.stdout.write(`\nAll ${checks} agent harness checks passed.\n`)
