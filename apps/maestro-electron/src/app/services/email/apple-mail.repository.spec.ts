import { ChildProcess } from 'child_process'
import { once } from 'events'
import { app } from 'electron'
import * as fs from 'fs/promises'
import { tmpdir } from 'os'
import { basename, join } from 'path'
import { PassThrough } from 'stream'
import { lastValueFrom, toArray } from 'rxjs'
import { AppSettings } from '@release-maestro/core'
import { InMemoryStore } from '../../utils/persistent-store.util'
import { SettingsBackendService } from '../settings.backend.service'
import { AppleMailRepository, formatAppleScriptDate } from './apple-mail.repository'

const mockSpawn = jest.fn<ChildProcess, [string, string[], { signal: AbortSignal }]>()
jest.mock('child_process', () => ({
    ...jest.requireActual('child_process'),
    spawn: (...args: Parameters<typeof mockSpawn>) => mockSpawn(...args),
}))
jest.mock('electron', () => ({ app: { getPath: jest.fn() } }))
jest.mock('../../app-env', () => ({ appPaths: { resources: '/resources' } }))

const dataFile = (subject: string, dateReceived: string) =>
    [
        `messageId: <${subject}@example.com>`,
        'sender: Bandcamp <noreply@bandcamp.com>',
        `subject: ${subject}`,
        `dateReceived: ${dateReceived}`,
        'isRead: false',
        '==========================================',
        '==========================================',
        'Body',
    ].join('\n')

/** Stands in for osascript: resolves with the spawn args once the export starts. */
const fakeExport = () => {
    const child = new ChildProcess()
    const stderr = new PassThrough()
    child.stderr = stderr
    child.stdout = new PassThrough()
    Object.defineProperty(child, 'pid', { value: 4242 })

    const started = new Promise<string[]>(resolve => {
        mockSpawn.mockImplementation((_command, args) => {
            resolve(args)
            return child
        })
    })

    return {
        started,
        log: (chunk: string) => stderr.write(chunk),
        exit: async (exitCode: number) => {
            stderr.end()
            await once(stderr, 'end')
            child.emit('close', exitCode, null)
        },
    }
}

describe('AppleMailRepository', () => {
    let tempPath: string
    let settings: SettingsBackendService

    beforeEach(async () => {
        tempPath = await fs.mkdtemp(join(tmpdir(), 'maestro-mail-test-'))
        jest.mocked(app.getPath).mockReturnValue(tempPath)
        settings = new SettingsBackendService(new InMemoryStore<AppSettings>())
        settings.patchSettings({ emailPluginConfig: { APPLE_MAIL: { mailboxName: 'Releases' } } })
    })

    afterEach(async () => {
        mockSpawn.mockReset()
        await fs.rm(tempPath, { recursive: true, force: true })
    })

    const loadAll = (receivedSince: Date | null = null, abortSignal = new AbortController().signal) =>
        lastValueFrom(
            new AppleMailRepository(settings).loadEmails(abortSignal, receivedSince).pipe(toArray()),
        )

    it('exports into a fresh directory', async () => {
        const staleExportPath = join(tempPath, 'apple-mail-export-previous')
        await fs.mkdir(staleExportPath)
        await fs.writeFile(join(staleExportPath, 'stale.txt'), 'previous export')
        const osascript = fakeExport()

        const result = loadAll()

        const [, , exportPath] = await osascript.started
        if (!exportPath) throw new Error('Export path missing from osascript arguments')
        expect(basename(exportPath)).toMatch(/^apple-mail-export-/)
        expect(exportPath).not.toBe(staleExportPath)
        await expect(fs.readdir(exportPath)).resolves.toEqual([])
        await osascript.exit(0)
        await expect(result).resolves.toEqual([])
    })

    it('exports the whole mailbox without a received-since date', async () => {
        const osascript = fakeExport()

        const result = loadAll()

        await expect(osascript.started).resolves.toEqual([
            '/resources/apple-scripts/export-emails.applescript',
            'Releases',
            expect.any(String),
        ])
        await osascript.exit(0)
        await result
    })

    it('passes the received-since date to the script in local time', async () => {
        const osascript = fakeExport()

        const result = loadAll(new Date(2026, 0, 5, 7, 8, 9))

        const args = await osascript.started
        expect(args[3]).toBe('2026-01-05T07:08:09')
        await osascript.exit(0)
        await result
    })

    it('emits every exported email, even when output is split mid-line and the export exits at once', async () => {
        const osascript = fakeExport()
        const result = loadAll()
        const [, , exportPath] = await osascript.started
        if (!exportPath) throw new Error('Export path missing from osascript arguments')
        const first = join(exportPath, 'email-1.txt')
        const second = join(exportPath, 'email-2.txt')
        await fs.writeFile(first, dataFile('First', '2026-10-01T08:00:00'))
        await fs.writeFile(second, dataFile('Second', '2026-10-01T09:00:00'))

        osascript.log(`Processed email 1/2: ${first}\nProcessed em`)
        osascript.log(`ail 2/2: ${second}\n`)
        await osascript.exit(0)

        const packets = await result
        expect(packets.map(({ current, total, email }) => [current, total, email.subject])).toEqual([
            [1, 2, 'First'],
            [2, 2, 'Second'],
        ])
    })

    it("fails with Mail's own error message when the export fails", async () => {
        const osascript = fakeExport()
        const result = loadAll()
        await osascript.started

        osascript.log('execution error: Mail got an error: Can’t get mailbox "Releases". (-1728)\n')
        await osascript.exit(1)

        await expect(result).rejects.toThrow('[AppleMailImporter] Can’t get mailbox "Releases". (-1728)')
    })

    it('completes rather than fails when the import is cancelled', async () => {
        const osascript = fakeExport()
        const abortController = new AbortController()
        const result = loadAll(null, abortController.signal)
        await osascript.started

        abortController.abort()
        await osascript.exit(143)

        await expect(result).resolves.toEqual([])
    })

    it('formats dates as zero-padded local time', () => {
        expect(formatAppleScriptDate(new Date(2026, 11, 31, 23, 59, 0))).toBe('2026-12-31T23:59:00')
    })
})
