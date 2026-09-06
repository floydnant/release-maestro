#!/usr/bin/env node

// Purpose: Validate the canonical agent-skill tree and its harness adapters offline.
//
// Source of truth is .agents/skills/<name>/SKILL.md. Harness directories hold adapters only:
// a relative symlink per skill, unless the skill is declared divergent in
// .agents/harness-overrides.json. Runs on Node with no dependencies so it works before install.

import { existsSync, lstatSync, readFileSync, readdirSync, readlinkSync, statSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
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

// --- Minimal frontmatter reader -------------------------------------------------------------
// Handles `key: scalar`, quoted scalars, and folded/literal blocks (`>`, `>-`, `|`, `|-`).
// That is the whole vocabulary the skill frontmatter and the openai.yaml sidecars use.

function unquote(value) {
    const trimmed = value.trim()
    if (trimmed.length >= 2 && (trimmed.startsWith("'") || trimmed.startsWith('"'))) {
        const quote = trimmed[0]
        if (trimmed.endsWith(quote)) return trimmed.slice(1, -1).replaceAll(quote + quote, quote)
    }
    return trimmed
}

function parseBlock(lines, indent = 0) {
    const result = {}
    for (let i = 0; i < lines.length; i += 1) {
        const line = lines[i]
        if (!line.trim() || line.trimStart().startsWith('#')) continue
        const leading = line.length - line.trimStart().length
        if (leading !== indent) continue

        const match = /^([A-Za-z$][\w$-]*):[ \t]*(.*)$/.exec(line.trim())
        if (!match) continue
        const [, key, rawValue] = match

        if (rawValue === '' || /^[|>][-+]?$/.test(rawValue)) {
            const body = []
            let j = i + 1
            for (; j < lines.length; j += 1) {
                const next = lines[j]
                if (next.trim() && next.length - next.trimStart().length <= indent) break
                body.push(next)
            }
            result[key] =
                rawValue === ''
                    ? parseBlock(
                          body,
                          body.find(l => l.trim())
                              ? body.find(l => l.trim()).length - body.find(l => l.trim()).trimStart().length
                              : indent + 4,
                      )
                    : body
                          .map(l => l.trim())
                          .filter(Boolean)
                          .join(rawValue.startsWith('|') ? '\n' : ' ')
            i = j - 1
            continue
        }
        result[key] = unquote(rawValue)
    }
    return result
}

function readFrontmatter(file) {
    const text = readFileSync(file, 'utf8')
    const lines = text.split('\n')
    if (lines[0] !== '---') return null
    const end = lines.indexOf('---', 1)
    if (end === -1) return null
    return parseBlock(lines.slice(1, end))
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

const harnesses = Object.entries(manifest.harnesses ?? {}).map(([id, config]) => ({
    id,
    skillsDir: config.skillsDir,
    diverge: new Set(config.diverge ?? []),
}))

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

    const frontmatter = readFrontmatter(skillFile)
    if (
        !assert(
            frontmatter !== null,
            `${label} has complete YAML frontmatter`,
            `${label} must open and close its frontmatter with ---`,
        )
    )
        continue

    assert(
        frontmatter.name === name,
        `${label} name matches its directory`,
        `${label} declares name '${frontmatter.name ?? ''}' but sits in '${name}'`,
    )

    const description = frontmatter.description ?? ''
    assert(
        description.length > 0 && description.length <= 1024,
        `${label} has a description`,
        `${label} needs a description of 1 to 1024 characters (has ${description.length})`,
    )

    // --- openai.yaml sidecar ---
    const sidecar = join(skillDir, 'agents', 'openai.yaml')
    const sidecarLabel = rel(sidecar)
    if (!assert(existsSync(sidecar), `${sidecarLabel} exists`, `${rel(skillDir)} needs agents/openai.yaml`))
        continue

    const sidecarData = parseBlock(readFileSync(sidecar, 'utf8').split('\n'))
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
            declared === 'true' || declared === 'false',
            `${sidecarLabel} declares allow_implicit_invocation`,
            `${sidecarLabel} needs policy.allow_implicit_invocation set to true or false`,
        )
    ) {
        const modelInvocable = frontmatter['disable-model-invocation'] !== 'true'
        assert(
            (declared === 'true') === modelInvocable,
            `${sidecarLabel} invocation policy matches SKILL.md`,
            `${sidecarLabel} says allow_implicit_invocation: ${declared} but ${label} says disable-model-invocation: ${frontmatter['disable-model-invocation'] ?? 'false'}`,
        )
    }
}

// --- Harness adapters, both directions --------------------------------------------------------

const canonicalNames = new Set(skillNames)

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
        const expected = join('../..', '.agents', 'skills', name)

        if (harness.diverge.has(name)) {
            const isRealDir =
                existsSync(adapter) && !lstatSync(adapter).isSymbolicLink() && statSync(adapter).isDirectory()
            assert(
                isRealDir && existsSync(join(adapter, 'SKILL.md')),
                `${adapterLabel} is a declared divergence with its own SKILL.md`,
                `${adapterLabel} is declared divergent, so it must be a real directory containing SKILL.md`,
            )
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
    for (const entry of readdirSync(adapterRoot)) {
        assert(
            canonicalNames.has(entry),
            `${harness.skillsDir}/${entry} has a canonical source`,
            `${harness.skillsDir}/${entry} has no .agents/skills/${entry} behind it — stale adapter`,
        )
    }

    // No copied skill content
    for (const entry of readdirSync(adapterRoot)) {
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

for (const file of skillNames.length ? markdownFiles(canonicalDir) : []) {
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
    `all ${checkedReferences} cross-references in .agents/skills resolve`,
    `${brokenReferences} of ${checkedReferences} cross-references in .agents/skills do not resolve`,
)

// --- Summary -------------------------------------------------------------------------------------

if (failures > 0) {
    process.stderr.write(`\n${failures} of ${checks} agent harness checks failed.\n`)
    process.exit(1)
}

process.stdout.write(`\nAll ${checks} agent harness checks passed.\n`)
