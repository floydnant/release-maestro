import assert from 'node:assert/strict'
import { rmSync, symlinkSync, unlinkSync } from 'node:fs'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { test } from 'node:test'
import { fixture, skill, sidecar } from './fixtures/agent-harness.mjs'

const verifier = fileURLToPath(new URL('./verify-agent-harness.mjs', import.meta.url))
function check(t, options, mutate, expected) {
    const f = fixture(options)
    t.after(() => rmSync(f.root, { recursive: true, force: true }))
    mutate?.(f)
    const result = spawnSync(process.execPath, [verifier, f.root], { encoding: 'utf8' })
    assert.equal(result.status, expected ? 1 : 0, result.stdout + result.stderr)
    if (expected) assert.match(result.stderr, expected)
    assert.doesNotMatch(result.stderr, /TypeError|at file:\/\//)
}

test('canonical symlinks pass at multiple directory depths', t => {
    for (const skillsDir of ['adapters', '.claude/skills', 'nested/harness/skills']) check(t, { skillsDir })
})
test('divergent skills pass without a Codex sidecar', t => check(t, { divergent: true }))
test('OS metadata files are ignored', t =>
    check(t, {}, f => {
        f.write('.claude/skills/.DS_Store', '')
        f.write('.claude/skills/Thumbs.db', '')
    }))
for (const contents of [
    '{',
    'null',
    '{}',
    '{"harnesses": []}',
    '{"harnesses":{"claude":null}}',
    '{"harnesses":{"claude":{}}}',
    '{"harnesses":{"claude":{"skillsDir":4}}}',
    '{"harnesses":{"claude":{"skillsDir":".claude/skills","diverge":"example"}}}',
]) {
    test(`malformed manifest fails: ${contents}`, t =>
        check(
            t,
            {},
            f => f.write('.agents/harness-overrides.json', contents),
            /not ok.*harness-overrides.json/,
        ))
}
for (const divergent of [false, true]) {
    const options = { divergent }
    const path = divergent ? '.claude/skills/example/SKILL.md' : '.agents/skills/example/SKILL.md'
    for (const [label, contents, expected] of [
        ['empty', '', /frontmatter/],
        ['unclosed frontmatter', '---\nname: example', /frontmatter/],
        ['wrong name', skill.replace('name: example', 'name: wrong'), /declares name/],
        ['blank description', skill.replace('Example skill', '" "'), /needs a description/],
        ['unclosed quote', skill.replace('Example skill', '"unterminated'), /invalid YAML/],
        ['invalid mapping', skill.replace('description:', 'description'), /invalid YAML/],
        ['duplicate key', skill.replace('description:', 'name: duplicate\ndescription:'), /invalid YAML/],
        ['broken link', skill + '\n[Missing](references/missing.md)\n', /does not resolve/],
    ])
        test(`${divergent ? 'divergent' : 'canonical'} ${label} fails`, t =>
            check(t, options, f => f.write(path, contents), expected))
}
for (const value of ['true', 'True', 'TRUE']) {
    test(`boolean ${value} agrees with disabled sidecar`, t =>
        check(t, {}, f => {
            f.write(
                '.agents/skills/example/SKILL.md',
                skill.replace('name:', `disable-model-invocation: ${value}\nname:`),
            )
            f.write('.agents/skills/example/agents/openai.yaml', sidecar.replace('true', 'False'))
        }))
}
for (const value of ['yes', '"true"', '1', 'null']) {
    test(`ambiguous policy ${value} fails`, t =>
        check(
            t,
            {},
            f =>
                f.write(
                    '.agents/skills/example/SKILL.md',
                    skill.replace('name:', `disable-model-invocation: ${value}\nname:`),
                ),
            /must be a YAML boolean/,
        ))
}
test('policy mismatch fails', t =>
    check(
        t,
        {},
        f => f.write('.agents/skills/example/agents/openai.yaml', sidecar.replace('true', 'false')),
        /invocation/,
    ))
test('sidecar invalid YAML fails', t =>
    check(
        t,
        {},
        f =>
            f.write(
                '.agents/skills/example/agents/openai.yaml',
                sidecar.replace('Example skill', '"unterminated'),
            ),
        /invalid YAML/,
    ))
test('sidecar string boolean fails', t =>
    check(
        t,
        {},
        f => f.write('.agents/skills/example/agents/openai.yaml', sidecar.replace('true', 'yes')),
        /set to true or false/,
    ))
test('stale broken adapter fails', t =>
    check(t, {}, f => symlinkSync('missing', join(f.root, '.claude/skills/stale')), /stale adapter/))
test('wrong symlink fails', t =>
    check(
        t,
        {},
        f => {
            unlinkSync(join(f.root, f.adapter))
            symlinkSync('missing', join(f.root, f.adapter))
        },
        /must be a symlink/,
    ))
test('undeclared copied skill fails', t =>
    check(
        t,
        {},
        f => {
            unlinkSync(join(f.root, f.adapter))
            f.write(`${f.adapter}/SKILL.md`, skill)
        },
        /must be a symlink/,
    ))
