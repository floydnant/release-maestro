import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { delimiter, join } from 'node:path'
import { test } from '@jest/globals'
import { parse } from 'yaml'

const workflow = parse(
    readFileSync(new URL('../../.github/workflows/security-notify.yml', import.meta.url), 'utf8'),
)
const script = workflow.jobs.notify.steps.find(step => step.run).run

for (const event of [
    null,
    {
        id: 42,
        name: 'Security',
        path: '.github/workflows/security.yml',
        head_sha: 'abc',
        head_branch: 'main',
        conclusion: 'failure',
        html_url: 'https://github.com/owner/repo/actions/runs/42',
        extra: 'not forwarded',
    },
]) {
    test(`notification uses the runner event file for ${event ? 'workflow failures' : 'manual delivery tests'}`, () => {
        const directory = mkdtempSync(join(tmpdir(), 'maestro notification-'))
        const eventPath = join(directory, 'event.json')
        const captured = join(directory, 'captured.json')
        try {
            writeFileSync(eventPath, JSON.stringify(event ? { workflow_run: event } : {}))
            // Execute the real payload code with a fake network sender and no usable jq.
            const curl = join(directory, 'curl')
            writeFileSync(
                curl,
                `#!/usr/bin/env node
const fs = require('node:fs');
const args = process.argv.slice(2);
const payload = args[args.indexOf('--data-binary') + 1].slice(1);
fs.writeFileSync(process.env.CAPTURE_PATH, fs.readFileSync(payload));
`,
            )
            chmodSync(curl, 0o755)
            const jq = join(directory, 'jq')
            writeFileSync(
                jq,
                '#!/usr/bin/env node\nprocess.stderr.write("jq is not installed"); process.exit(127);\n',
            )
            chmodSync(jq, 0o755)
            const env = {
                ...process.env,
                PATH: `${directory}${delimiter}${process.env.PATH}`,
                CAPTURE_PATH: captured,
                GITHUB_EVENT_PATH: eventPath,
                GITHUB_STEP_SUMMARY: join(directory, 'summary.md'),
                RUNNER_TEMP: directory,
                SECURITY_T3_WEBHOOK_URL: 'https://example.invalid/test-hook',
                REPOSITORY: 'owner/repo',
                RUN_ID: '99',
                EVENT_NAME: event ? 'workflow_run' : 'workflow_dispatch',
            }
            delete env.EVENT_PATH
            const result = spawnSync('bash', ['-e', '-o', 'pipefail', '-c', script], {
                env,
                encoding: 'utf8',
            })
            assert.equal(result.status, 0, result.stderr || result.stdout)
            assert.equal(existsSync(captured), true)
            const { extra: _extra, ...projected } = event ?? {}
            assert.deepEqual(JSON.parse(readFileSync(captured, 'utf8')), {
                repository: 'owner/repo',
                notification_run_id: '99',
                event: env.EVENT_NAME,
                workflow_run: event ? projected : null,
            })
            assert.match(readFileSync(env.GITHUB_STEP_SUMMARY, 'utf8'), /event delivered/)
        } finally {
            rmSync(directory, { recursive: true, force: true })
        }
    })
}
