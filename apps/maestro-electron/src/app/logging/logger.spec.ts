import { EventEmitter } from 'node:events'
import fs from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

let mockLogDirectory: string
const mockApp = Object.assign(new EventEmitter(), { isPackaged: true })

jest.mock('electron', () => ({ app: mockApp, ipcMain: { on: jest.fn() } }))
jest.mock('../app-env', () => ({
    appPaths: {
        get log() {
            return mockLogDirectory
        },
    },
}))
jest.mock('electron-log/main', () => {
    const logger = jest.requireActual<typeof import('electron-log/node')>('electron-log/node')
    logger.transports.ipc = Object.assign(jest.fn<void, [unknown]>(), {
        level: false,
        transforms: [],
    } satisfies Pick<typeof logger.transports.ipc, 'level' | 'transforms'>)
    return logger
})

describe('main diagnostic logging', () => {
    let logging: typeof import('./logger')
    let processOn: jest.SpyInstance<NodeJS.Process, Parameters<NodeJS.Process['on']>>

    beforeEach(async () => {
        jest.resetModules()
        mockApp.removeAllListeners()
        mockLogDirectory = fs.mkdtempSync(join(tmpdir(), 'maestro-logging-'))
        processOn = jest.spyOn(process, 'on').mockImplementation(() => process)
        logging = await import('./logger')
        logging.initializeLogging()
        const electronLog = await import('electron-log/main')
        electronLog.default.transports.console.level = false
    })

    afterEach(() => {
        jest.restoreAllMocks()
        fs.rmSync(mockLogDirectory, { recursive: true, force: true })
    })

    it('writes sanitized unhandled promise rejections to the file', async () => {
        const listener = processOn.mock.calls.find(([event]) => event === 'unhandledRejection')?.[1]
        expect(listener).toBeDefined()
        listener?.(new Error('could not load /Users/alice/Private Music/index.html'))

        const lines = await logging.readDiagnosticLines()
        expect(lines.map(line => JSON.parse(line))).toContainEqual(
            expect.objectContaining({
                level: 'error',
                source: 'main',
                event: 'process.unhandled-rejection',
                fields: expect.objectContaining({ errorMessage: 'could not load [path]' }),
            }),
        )
        expect(lines.join('\n')).not.toContain('Private Music')
    })

    it.each([false, true])('keeps complete records after rotation, rename failure: %s', async renameFails => {
        const electronLog = await import('electron-log/main')
        electronLog.default.transports.file.maxSize = 4_096
        const backup = JSON.stringify({ event: 'previous.backup' })
        fs.writeFileSync(logging.diagnosticLogFiles()[0], `${backup}\n`)
        const rename = jest.spyOn(fs, 'renameSync')
        if (renameFails) {
            rename.mockImplementation(() => {
                throw Object.assign(new Error('backup is locked'), { code: 'EPERM' })
            })
        }
        const log = logging.createMainLogger('rotation')
        for (let index = 0; index < 40; index++) {
            log.info('rotation.event', { index, text: '音楽'.repeat(80) })
        }

        expect(rename).toHaveBeenCalled()
        const lines = await logging.readDiagnosticLines()
        const current = fs.readFileSync(logging.diagnosticLogFiles()[1], 'utf8').trim().split('\n')
        // Check the files too: filtering invalid lines at export must not conceal a broken writer.
        for (const line of [...lines, ...current]) expect(() => JSON.parse(line)).not.toThrow()
        expect(current.map(line => JSON.parse(line))).toEqual(
            expect.arrayContaining([
                expect.objectContaining({ fields: expect.objectContaining({ index: 38 }) }),
                expect.objectContaining({ fields: expect.objectContaining({ index: 39 }) }),
            ]),
        )
        expect(fs.statSync(logging.diagnosticLogFiles()[1]).size).toBeLessThan(5_000)
        if (renameFails) expect(fs.readFileSync(logging.diagnosticLogFiles()[0], 'utf8')).toBe(`${backup}\n`)
    })

    it('omits damaged legacy records from preview and export lines', async () => {
        const older = JSON.stringify({ event: 'older.valid' })
        const newer = JSON.stringify({ event: 'newer.valid' })
        fs.writeFileSync(logging.diagnosticLogFiles()[0], `${older}\n[log cropped]\npartial-record}\n`)
        fs.writeFileSync(logging.diagnosticLogFiles()[1], `${newer}\n{"event":"incomplete`)

        await expect(logging.readDiagnosticLines()).resolves.toEqual([older, newer])
    })
})
