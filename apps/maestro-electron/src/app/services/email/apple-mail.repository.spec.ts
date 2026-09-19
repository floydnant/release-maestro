import { ChildProcess } from 'child_process'
import { app } from 'electron'
import * as fs from 'fs/promises'
import { tmpdir } from 'os'
import { basename, join } from 'path'
import { PassThrough } from 'stream'
import { lastValueFrom, toArray } from 'rxjs'
import { AppSettings } from '@release-maestro/core'
import { InMemoryStore } from '../../utils/persistent-store.util'
import { SettingsBackendService } from '../settings.backend.service'
import { AppleMailRepository } from './apple-mail.repository'

const mockExec = jest.fn<ChildProcess, [string, { signal: AbortSignal }, (error: Error | null) => void]>()
jest.mock('child_process', () => ({
    ...jest.requireActual('child_process'),
    exec: (...args: Parameters<typeof mockExec>) => mockExec(...args),
}))
jest.mock('electron', () => ({ app: { getPath: jest.fn() } }))
jest.mock('../../app-env', () => ({ appPaths: { resources: '/resources' } }))

describe('AppleMailRepository', () => {
    let tempPath: string

    beforeEach(async () => {
        tempPath = await fs.mkdtemp(join(tmpdir(), 'maestro-mail-test-'))
        jest.mocked(app.getPath).mockReturnValue(tempPath)
    })

    afterEach(async () => {
        mockExec.mockReset()
        await fs.rm(tempPath, { recursive: true, force: true })
    })

    it('exports into a fresh directory', async () => {
        const staleExportPath = join(tempPath, 'apple-mail-export-previous')
        await fs.mkdir(staleExportPath)
        await fs.writeFile(join(staleExportPath, 'stale.txt'), 'previous export')

        const child = new ChildProcess()
        child.stderr = new PassThrough()
        child.stdout = new PassThrough()
        let finish: () => void = () => undefined
        let started: (exportPath: string) => void = () => undefined
        const exportStarted = new Promise<string>(resolve => {
            started = resolve
        })
        mockExec.mockImplementation((command, _options, callback) => {
            const exportPath = command.match(/"([^"]+)"$/)?.[1]
            if (!exportPath) throw new Error('Export path missing from osascript command')
            finish = () => callback(null)
            started(exportPath)
            return child
        })

        const settings = new SettingsBackendService(new InMemoryStore<AppSettings>())
        settings.patchSettings({ emailPluginConfig: { APPLE_MAIL: { mailboxName: 'Releases' } } })
        const result = lastValueFrom(
            new AppleMailRepository(settings).loadEmails(new AbortController().signal).pipe(toArray()),
        )

        const exportPath = await exportStarted
        expect(basename(exportPath)).toMatch(/^apple-mail-export-/)
        expect(exportPath).not.toBe(staleExportPath)
        await expect(fs.readdir(exportPath)).resolves.toEqual([])
        finish()
        await expect(result).resolves.toEqual([])
    })
})
