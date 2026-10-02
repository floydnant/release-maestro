import { ChildProcess } from 'child_process'
import { once } from 'events'
import { app } from 'electron'
import * as fs from 'fs/promises'
import { tmpdir } from 'os'
import { basename, join } from 'path'
import { PassThrough } from 'stream'
import { lastValueFrom, toArray } from 'rxjs'
import { AppleMailRepository, formatAppleScriptDate } from './apple-mail.repository'

const mockSpawn = jest.fn<ChildProcess, [string, string[], { signal: AbortSignal }]>()
const mockExecFile = jest.fn<void, [string, string[], (error: Error | null, stdout: string) => void]>()
jest.mock('child_process', () => ({
    ...jest.requireActual('child_process'),
    spawn: (...args: Parameters<typeof mockSpawn>) => mockSpawn(...args),
    execFile: (...args: Parameters<typeof mockExecFile>) => mockExecFile(...args),
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

const writeEmail = async (filePath: string, contents: string, html = '') => {
    await Promise.all([
        fs.writeFile(filePath, contents),
        fs.writeFile(filePath.replace(/\.txt$/, '.html'), html),
    ])
}

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
    /** What happened to Mail and to the stream, in order. */
    let events: string[]
    let isMailRunning: boolean

    beforeEach(async () => {
        tempPath = await fs.mkdtemp(join(tmpdir(), 'maestro-mail-test-'))
        jest.mocked(app.getPath).mockReturnValue(tempPath)
        events = []
        isMailRunning = true
        mockExecFile.mockImplementation((_command, [, script], callback) => {
            if (script?.includes('to quit')) {
                // Quitting takes a while, so only awaiting it can order it before the stream settles
                setImmediate(() => {
                    events.push('quit Mail')
                    callback(null, '')
                })
            } else {
                callback(null, String(isMailRunning))
            }
        })
    })

    afterEach(async () => {
        jest.restoreAllMocks()
        mockSpawn.mockReset()
        mockExecFile.mockReset()
        await fs.rm(tempPath, { recursive: true, force: true })
    })

    const loadAll = (receivedSince: Date | null = null, abortSignal = new AbortController().signal) =>
        lastValueFrom(
            new AppleMailRepository().loadEmails(abortSignal, 'Releases', receivedSince).pipe(toArray()),
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
        await writeEmail(first, dataFile('First', '2026-10-01T08:00:00'))
        await writeEmail(second, dataFile('Second', '2026-10-01T09:00:00'))

        osascript.log(`Processed email 1/2: ${first}\nProcessed em`)
        osascript.log(`ail 2/2: ${second}\n`)
        await osascript.exit(0)

        const packets = await result
        expect(packets.map(({ current, total, email }) => [current, total, email?.subject])).toEqual([
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

    it("reports Mail's error even when it arrives behind emails still being read", async () => {
        const osascript = fakeExport()
        const result = loadAll()
        const [, , exportPath] = await osascript.started
        if (!exportPath) throw new Error('Export path missing from osascript arguments')
        const first = join(exportPath, 'email-1.txt')
        await writeEmail(first, dataFile('First', '2026-10-01T08:00:00'))

        osascript.log(`Processed email 1/2: ${first}\n`)
        osascript.log('execution error: Mail got an error: AppleEvent timed out. (-1712)\n')
        await osascript.exit(1)

        await expect(result).rejects.toThrow('[AppleMailImporter] AppleEvent timed out. (-1712)')
    })

    it('skips an unreadable email and still emits the rest without failing the export', async () => {
        const osascript = fakeExport()
        const result = loadAll()
        const [, , exportPath] = await osascript.started
        if (!exportPath) throw new Error('Export path missing from osascript arguments')
        const missing = join(exportPath, 'email-1.txt')
        const second = join(exportPath, 'email-2.txt')
        await writeEmail(second, dataFile('Second', '2026-10-01T09:00:00'))

        osascript.log(`Processed email 1/2: ${missing}\nProcessed email 2/2: ${second}\n`)
        await osascript.exit(0)

        await expect(result).resolves.toEqual([
            { current: 1, total: 2, email: null },
            { current: 2, total: 2, email: expect.objectContaining({ subject: 'Second' }) },
        ])
    })

    it('skips an email that still does not parse after retrying', async () => {
        const osascript = fakeExport()
        const result = loadAll()
        const [, , exportPath] = await osascript.started
        if (!exportPath) throw new Error('Export path missing from osascript arguments')
        const truncated = join(exportPath, 'email-1.txt')
        await writeEmail(truncated, 'messageId: <cut-off@example.com>\nsen')
        const readFile = jest.spyOn(jest.requireActual<typeof fs>('fs/promises'), 'readFile')

        osascript.log(`Processed email 1/1: ${truncated}\n`)
        await osascript.exit(0)

        await expect(result).resolves.toEqual([{ current: 1, total: 1, email: null }])
        expect(readFile.mock.calls.filter(([path]) => path === truncated)).toHaveLength(3)
    })

    it.each(['missing', 'unreadable'])('does not accept %s HTML as an empty body', async failure => {
        const osascript = fakeExport()
        const result = loadAll()
        const [, , exportPath] = await osascript.started
        if (!exportPath) throw new Error('Export path missing from osascript arguments')
        const filePath = join(exportPath, 'email-1.txt')
        await fs.writeFile(filePath, dataFile('First', '2026-10-01T08:00:00'))
        if (failure === 'unreadable') await fs.mkdir(filePath.replace(/\.txt$/, '.html'))

        osascript.log(`Processed email 1/1: ${filePath}\n`)
        await osascript.exit(0)

        await expect(result).resolves.toEqual([{ current: 1, total: 1, email: null }])
    })

    it('accepts an explicitly exported empty HTML file', async () => {
        const osascript = fakeExport()
        const result = loadAll()
        const [, , exportPath] = await osascript.started
        if (!exportPath) throw new Error('Export path missing from osascript arguments')
        const filePath = join(exportPath, 'email-1.txt')
        await writeEmail(filePath, dataFile('Plain-text notification', '2026-10-01T08:00:00'))

        osascript.log(`Processed email 1/1: ${filePath}\n`)
        await osascript.exit(0)

        await expect(result).resolves.toEqual([
            { current: 1, total: 1, email: expect.objectContaining({ htmlBody: '' }) },
        ])
    })

    it('retries a transient read failure within the same export', async () => {
        const osascript = fakeExport()
        const result = loadAll()
        const [, , exportPath] = await osascript.started
        if (!exportPath) throw new Error('Export path missing from osascript arguments')
        const filePath = join(exportPath, 'email-1.txt')
        await writeEmail(filePath, dataFile('First', '2026-10-01T08:00:00'), '<p>Recovered HTML</p>')
        const readFile = jest
            .spyOn(jest.requireActual<typeof fs>('fs/promises'), 'readFile')
            .mockRejectedValueOnce(new Error('Temporary read failure'))

        osascript.log(`Processed email 1/1: ${filePath}\n`)
        await osascript.exit(0)

        await expect(result).resolves.toEqual([
            { current: 1, total: 1, email: expect.objectContaining({ htmlBody: '<p>Recovered HTML</p>' }) },
        ])
        expect(readFile.mock.calls.filter(([path]) => path === filePath)).toHaveLength(2)
    })

    it('reports a message that the script could not export after retrying', async () => {
        const osascript = fakeExport()
        const result = loadAll()
        await osascript.started

        osascript.log('Failed email 1/1: Mail could not read the message source\n')
        await osascript.exit(0)

        await expect(result).resolves.toEqual([{ current: 1, total: 1, email: null }])
    })

    it('stops reading retries promptly when cancelled', async () => {
        const osascript = fakeExport()
        const abortController = new AbortController()
        const result = loadAll(null, abortController.signal)
        const [, , exportPath] = await osascript.started
        if (!exportPath) throw new Error('Export path missing from osascript arguments')
        const filePath = join(exportPath, 'email-1.txt')
        await writeEmail(filePath, dataFile('First', '2026-10-01T08:00:00'))
        const readFile = jest
            .spyOn(jest.requireActual<typeof fs>('fs/promises'), 'readFile')
            .mockImplementationOnce(async () => {
                abortController.abort()
                throw new Error('Cancelled during read')
            })

        osascript.log(`Processed email 1/1: ${filePath}\n`)
        await osascript.exit(143)

        await expect(result).resolves.toEqual([])
        expect(readFile.mock.calls.filter(([path]) => path === filePath)).toHaveLength(1)
    })

    it('fails without exporting when no mailbox is configured', async () => {
        await expect(
            lastValueFrom(new AppleMailRepository().loadEmails(new AbortController().signal, null, null)),
        ).rejects.toThrow('[AppleMailImporter] Mailbox name is not set in settings')
        expect(mockSpawn).not.toHaveBeenCalled()
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

    it('leaves Mail open when it was already running', async () => {
        const osascript = fakeExport()
        const result = loadAll()
        await osascript.started

        await osascript.exit(0)

        await result
        expect(events).toEqual([])
    })

    it.each([
        ['completes', 0, false],
        ['fails', 1, false],
        ['is cancelled', 143, true],
    ])('quits Mail it opened before the stream settles when the export %s', async (_, exitCode, abort) => {
        isMailRunning = false
        const osascript = fakeExport()
        const abortController = new AbortController()
        const result = new Promise<void>(resolve => {
            const settle = () => {
                events.push('settled')
                resolve()
            }
            new AppleMailRepository()
                .loadEmails(abortController.signal, 'Releases', null)
                .subscribe({ error: settle, complete: settle })
        })
        await osascript.started

        if (abort) abortController.abort()
        await osascript.exit(exitCode)

        await result
        expect(events).toEqual(['quit Mail', 'settled'])
    })

    it('formats dates as zero-padded local time', () => {
        expect(formatAppleScriptDate(new Date(2026, 11, 31, 23, 59, 0))).toBe('2026-12-31T23:59:00')
    })
})
