import assert from 'node:assert/strict'
import { readFileSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { isValidPrTitle } from './verify-pr-title.mjs'

for (const [title, valid] of [
    ['fix(IPC): preserve channel', true],
    ['deps: bump package', true],
    ['feat(renderer)!: change behavior', true],
    ['fix: x', true],
    ['', false],
    ['fix: missing\rextra line', false],
    ['fix: ', false],
    ['fix:    ', false],
    ['fix: \t', false],
    ['fix: missing\nextra line', false],
    ['misc: something', false],
    ['fix(bad scope): change', false],
    ['fix: $(exit 42)', true],
])
    test(`PR title ${JSON.stringify(title)}`, () => {
        assert.equal(isValidPrTitle(title), valid)
    })

const verifier = fileURLToPath(new URL('./verify-pr-title.mjs', import.meta.url))
for (const [title, status] of [
    ['fix: preserve channel', 0],
    ['fix: ', 1],
]) {
    test(`CLI exits with ${status} and reports the result`, t => {
        const dir = mkdtempSync(join(tmpdir(), 'pr-title-'))
        t.after(() => rmSync(dir, { recursive: true, force: true }))
        const summary = join(dir, 'summary')
        const result = spawnSync(process.execPath, [verifier], {
            encoding: 'utf8',
            env: { ...process.env, TITLE: title, GITHUB_STEP_SUMMARY: summary },
        })
        assert.equal(result.status, status, result.stdout + result.stderr)
        if (status === 1) {
            assert.match(result.stderr, /::error title=Pull request title/)
            assert.match(readFileSync(summary, 'utf8'), /Expected `type\(optional-scope\)!: description`/)
        } else {
            assert.match(result.stdout, /ok -/)
        }
    })
}
