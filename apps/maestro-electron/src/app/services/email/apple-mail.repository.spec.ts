import { ChildProcess } from 'child_process'
import { app } from 'electron'
import * as fs from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import { PassThrough } from 'stream'
import { lastValueFrom, toArray } from 'rxjs'
import { AppSettings } from '@release-maestro/core'
import { appleMailData } from '../../../test/fixtures/apple-mail.fixture'
import { InMemoryStore } from '../../utils/persistent-store.util'
import { SettingsBackendService } from '../settings.backend.service'
import { AppleMailRepository } from './apple-mail.repository'

const mockExecFile = jest.fn<
    ChildProcess,
    [string, string[], { signal: AbortSignal }, (error: Error | null) => void]
>()
jest.mock('child_process', () => ({
    ...jest.requireActual('child_process'),
    execFile: (...args: Parameters<typeof mockExecFile>) => mockExecFile(...args),
}))
jest.mock('fs/promises', () => ({ __esModule: true, ...jest.requireActual('fs/promises') }))
jest.mock('electron', () => ({ app: { getPath: jest.fn() } }))
jest.mock('../../app-env', () => ({ appPaths: { resources: '/resources' } }))

describe('AppleMailRepository export lifecycle', () => {
    let tempPath: string
    let exportPath: string
    let settings: SettingsBackendService
    let repository: AppleMailRepository
    let child: ChildProcess
    let stderr: PassThrough
    let finish: (error?: Error) => void
    let started: Promise<void>

    beforeEach(async () => {
        jest.spyOn(console, 'log').mockImplementation(() => undefined)
        jest.spyOn(console, 'error').mockImplementation(() => undefined)
        tempPath = await fs.mkdtemp(join(tmpdir(), 'maestro-mail-test-'))
        exportPath = join(tempPath, 'apple-mail-export')
        jest.mocked(app.getPath).mockReturnValue(tempPath)
        settings = new SettingsBackendService(new InMemoryStore<AppSettings>())
        settings.patchSettings({ emailPluginConfig: { APPLE_MAIL: { mailboxName: 'Releases' } } })
        repository = new AppleMailRepository(settings)
        child = new ChildProcess()
        stderr = new PassThrough()
        child.stderr = stderr
        child.stdout = new PassThrough()
        started = new Promise(resolve => {
            mockExecFile.mockImplementation((_command, _args, _options, callback) => {
                finish = error => {
                    callback(error ?? null)
                    child.emit('close', error ? 1 : 0, null)
                }
                resolve()
                return child
            })
        })
    })

    afterEach(async () => {
        jest.restoreAllMocks()
        mockExecFile.mockReset()
        await fs.rm(tempPath, { recursive: true, force: true })
    })

    const collect = (repository: AppleMailRepository, signal = new AbortController().signal) =>
        lastValueFrom(repository.loadEmails(signal).pipe(toArray()))

    it('removes stale exports before starting osascript and exports once for multiple subscribers', async () => {
        await fs.mkdir(exportPath)
        await fs.writeFile(join(exportPath, 'stale.txt'), 'previous failed run')
        const stream = repository.loadEmails(new AbortController().signal)
        const first = lastValueFrom(stream.pipe(toArray()))
        const second = lastValueFrom(stream.pipe(toArray()))
        await started
        await expect(fs.stat(exportPath)).rejects.toMatchObject({ code: 'ENOENT' })
        expect(mockExecFile).toHaveBeenCalledTimes(1)
        expect(mockExecFile).toHaveBeenCalledWith(
            'osascript',
            ['/resources/apple-scripts/export-emails.applescript', 'Releases', exportPath],
            expect.anything(),
            expect.any(Function),
        )
        finish()
        await expect(first).resolves.toEqual([])
        await expect(second).resolves.toEqual([])
    })

    it('accepts a missing export directory and removes newly exported files after the last read', async () => {
        const result = collect(repository)
        await started
        await fs.mkdir(exportPath)
        const dataPath = join(exportPath, 'message.txt')
        await fs.writeFile(dataPath, appleMailData)
        stderr.write(`Processed email 1/1: ${dataPath}\n`)
        finish()
        await expect(result).resolves.toMatchObject([
            { current: 1, total: 1, email: { messageId: 'message-1', subject: 'New release' } },
        ])
        await expect(fs.stat(exportPath)).rejects.toMatchObject({ code: 'ENOENT' })
    })

    it('does not launch osascript when startup cleanup fails, and permits a retry', async () => {
        const failure = new Error('permission denied')
        jest.spyOn(fs, 'rm').mockRejectedValueOnce(failure)
        await expect(collect(repository)).rejects.toBe(failure)
        expect(mockExecFile).not.toHaveBeenCalled()
        const retry = collect(repository)
        await started
        finish()
        await expect(retry).resolves.toEqual([])
    })

    it('rejects another plugin instance while the shared export directory is in use', async () => {
        const first = collect(repository)
        await started
        await fs.mkdir(exportPath)
        const activePath = join(exportPath, 'active.txt')
        await fs.writeFile(activePath, 'in use')
        await expect(collect(new AppleMailRepository(settings))).rejects.toThrow('already running')
        await expect(fs.readFile(activePath, 'utf8')).resolves.toBe('in use')
        expect(mockExecFile).toHaveBeenCalledTimes(1)
        finish()
        await first
        const retry = collect(new AppleMailRepository(settings))
        await new Promise<void>(resolve => {
            mockExecFile.mockImplementationOnce((_command, _args, _options, callback) => {
                queueMicrotask(() => {
                    callback(null)
                    child.emit('close', 0, null)
                })
                resolve()
                return child
            })
        })
        await expect(retry).resolves.toEqual([])
    })

    it('removes partial files after a process failure and preserves the Mail error', async () => {
        const result = collect(repository)
        const assertion = expect(result).rejects.toThrow('[AppleMailImporter] Missing mailbox')
        await started
        await fs.mkdir(exportPath)
        await fs.writeFile(join(exportPath, 'partial.txt'), 'incomplete')
        finish(new Error('Mail got an error: Missing mailbox'))
        await assertion
        await expect(fs.stat(exportPath)).rejects.toMatchObject({ code: 'ENOENT' })
    })

    it('does not touch the directory or launch osascript for a pre-aborted import', async () => {
        const controller = new AbortController()
        controller.abort()
        await fs.mkdir(exportPath)
        await expect(collect(repository, controller.signal)).resolves.toEqual([])
        expect(mockExecFile).not.toHaveBeenCalled()
        await expect(fs.stat(exportPath)).resolves.toBeDefined()
    })

    it('does not launch osascript if canceled while startup cleanup is pending', async () => {
        const controller = new AbortController()
        let finishCleanup: () => void = () => undefined
        jest.spyOn(fs, 'rm').mockImplementationOnce(
            () =>
                new Promise<void>(resolve => {
                    finishCleanup = resolve
                }),
        )
        const result = collect(repository, controller.signal)
        controller.abort()
        finishCleanup()
        await expect(result).resolves.toEqual([])
        expect(mockExecFile).not.toHaveBeenCalled()
    })

    it('waits for the aborted child to close before removing files and releasing the directory', async () => {
        const controller = new AbortController()
        const result = collect(repository, controller.signal)
        await started
        await fs.mkdir(exportPath)
        const partialPath = join(exportPath, 'partial.txt')
        await fs.writeFile(partialPath, 'incomplete')
        controller.abort()
        const callback = mockExecFile.mock.calls[0]?.[3]
        callback?.(new Error('The operation was aborted'))
        await expect(fs.readFile(partialPath, 'utf8')).resolves.toBe('incomplete')
        await expect(collect(new AppleMailRepository(settings))).rejects.toThrow('already running')
        child.emit('close', null, 'SIGTERM')
        await expect(result).resolves.toEqual([])
        await expect(fs.stat(exportPath)).rejects.toMatchObject({ code: 'ENOENT' })
    })

    it('keeps the directory reserved until final cleanup finishes', async () => {
        const result = collect(repository)
        await started
        let finishCleanup: () => void = () => undefined
        const cleanupStarted = new Promise<void>(resolveStarted => {
            jest.spyOn(fs, 'rm').mockImplementationOnce(
                () =>
                    new Promise<void>(resolveCleanup => {
                        finishCleanup = resolveCleanup
                        resolveStarted()
                    }),
            )
        })
        finish()
        await cleanupStarted
        await expect(collect(new AppleMailRepository(settings))).rejects.toThrow('already running')
        finishCleanup()
        await expect(result).resolves.toEqual([])
    })

    it('logs final cleanup errors and lets the next import remove the leftover files', async () => {
        const result = collect(repository)
        await started
        await fs.mkdir(exportPath)
        const stalePath = join(exportPath, 'partial.txt')
        await fs.writeFile(stalePath, 'incomplete')
        const failure = new Error('directory busy')
        jest.spyOn(fs, 'rm').mockRejectedValueOnce(failure)
        finish()
        await expect(result).resolves.toEqual([])
        expect(console.error).toHaveBeenCalledWith(
            '[AppleMailImporter] Error removing export directory',
            exportPath,
            ':',
            failure,
        )
        const retryStarted = new Promise<void>(resolve => {
            mockExecFile.mockImplementationOnce((_command, _args, _options, callback) => {
                queueMicrotask(() => {
                    callback(null)
                    child.emit('close', 0, null)
                })
                resolve()
                return child
            })
        })
        const retry = collect(repository)
        await retryStarted
        await expect(fs.stat(stalePath)).rejects.toMatchObject({ code: 'ENOENT' })
        await expect(retry).resolves.toEqual([])
    })

    it('reports synchronous process startup errors and releases the directory', async () => {
        mockExecFile.mockImplementationOnce(() => {
            throw new Error('spawn failed')
        })
        await expect(collect(repository)).rejects.toThrow('spawn failed')
        const retry = collect(repository)
        await started
        finish()
        await expect(retry).resolves.toEqual([])
    })
})
