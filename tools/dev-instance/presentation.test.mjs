import assert from 'node:assert/strict'
import { test } from '@jest/globals'
import { developmentAppName, formatDevelopmentSummary, formatLogEvent } from './presentation.mjs'

const allocation = {
    bundle: { renderer: 4200, cdp: 9222, inspector: 5858 },
    appDataPath: '/tmp/release-maestro-data',
    slot: 0,
}

test('development summary resets the terminal column for every line', () => {
    assert.equal(
        formatDevelopmentSummary(allocation),
        [
            'Release Maestro dev instance [slot 0]',
            '  renderer  http://localhost:4200',
            '  CDP       http://127.0.0.1:9222',
            '  inspector http://127.0.0.1:5858',
            '  app data  /tmp/release-maestro-data',
            '',
        ].join('\r\n'),
    )
})

test('development app name identifies the allocated slot', () => {
    assert.equal(developmentAppName(allocation), 'Release Maestro dev [slot 0]')
    assert.equal(
        developmentAppName({
            bundle: { renderer: 4310, cdp: 9310, inspector: 5910 },
            slot: null,
        }),
        'Release Maestro dev [renderer 4310]',
    )
})

test('human log events put details on labeled lines', () => {
    assert.equal(
        formatLogEvent({
            at: '2026-09-22T01:00:00.000Z',
            event: 'holder-registered',
            worktreeId: 'worktree-1',
            role: 'dev-supervisor',
            holder: { pid: 42 },
        }),
        [
            '2026-09-22T01:00:00.000Z holder-registered',
            '  worktreeId: worktree-1',
            '  role: dev-supervisor',
            '  holder: {"pid":42}',
        ].join('\n'),
    )
})

test('human output can color event names and field labels', () => {
    const formatted = formatLogEvent(
        {
            at: '2026-09-22T01:00:00.000Z',
            event: 'holder-registered',
            role: 'dev-supervisor',
        },
        { color: true },
    )

    assert.match(formatted, /\u001b\[1mholder-registered\u001b\[0m/)
    assert.match(formatted, /\u001b\[36mrole\u001b\[0m/)
})
