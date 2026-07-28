import { Subject } from 'rxjs'
import { LibraryFolderValidation, LibraryScanUpdate } from '@release-maestro/core'
import { InMemoryStore } from '../../utils/persistent-store.util'
import { SettingsBackendService } from '../settings.backend.service'
import { LibraryFoldersService } from './library-folders.service'
import { LibraryScanService, LibraryScanState } from './library-scan.service'
import { LibraryBackendService } from './library.backend.service'

jest.mock('electron', () => ({
    BrowserWindow: { getAllWindows: () => [] },
}))

const availableFolder = (path: string): LibraryFolderValidation => ({
    path,
    canonicalPath: path,
    available: true,
})

describe('LibraryScanService', () => {
    let updates$: Subject<LibraryScanUpdate>
    let backend: { scan: jest.Mock }
    let folders: { validate: jest.Mock }
    let settings: { getSettings: jest.Mock }
    let stateStore: InMemoryStore<LibraryScanState>
    let service: LibraryScanService

    beforeEach(() => {
        jest.useFakeTimers()
        updates$ = new Subject<LibraryScanUpdate>()
        backend = { scan: jest.fn(() => updates$.asObservable()) }
        folders = {
            validate: jest.fn((paths: string[]) => Promise.resolve(paths.map(availableFolder))),
        }
        settings = { getSettings: jest.fn(() => ({ library: { folders: ['/music'] } })) }
        stateStore = new InMemoryStore<LibraryScanState>()
        service = new LibraryScanService(
            backend as unknown as LibraryBackendService,
            settings as unknown as SettingsBackendService,
            folders as unknown as LibraryFoldersService,
            stateStore,
        )
    })

    afterEach(() => {
        jest.useRealTimers()
    })

    it('stays idle when no folders are configured and never touches the pipeline', async () => {
        settings.getSettings.mockReturnValue({ library: { folders: [] } })

        const status = await service.startScan('startup')

        expect(status.phase).toBe('idle')
        expect(folders.validate).not.toHaveBeenCalled()
        expect(backend.scan).not.toHaveBeenCalled()
    })

    it('scans the reachable folders and reports the unreachable ones', async () => {
        settings.getSettings.mockReturnValue({ library: { folders: ['/music', '/usb/drive'] } })
        folders.validate.mockResolvedValue([
            availableFolder('/music'),
            { path: '/usb/drive', canonicalPath: '/usb/drive', available: false, error: 'not found' },
        ])

        const status = await service.startScan('startup')

        // The unplugged drive is dropped from the walk, not treated as fatal.
        expect(backend.scan).toHaveBeenCalledWith(['/music'], expect.anything())
        expect(status.phase).toBe('discovering')
        expect(status.scannedFolders).toEqual(['/music'])
        expect(status.unavailableFolders).toEqual(['/usb/drive'])
    })

    it('still scans when every folder is unavailable, so the library reconciles to missing', async () => {
        settings.getSettings.mockReturnValue({ library: { folders: ['/usb/drive'] } })
        folders.validate.mockResolvedValue([
            { path: '/usb/drive', canonicalPath: '/usb/drive', available: false, error: 'not found' },
        ])

        const status = await service.startScan('startup')

        // An empty walk discovers nothing, which is what marks everything missing.
        expect(backend.scan).toHaveBeenCalledWith([], expect.anything())
        expect(status.scannedFolders).toEqual([])
        expect(status.unavailableFolders).toEqual(['/usb/drive'])
    })

    it('scans canonical folders and omits folders nested under another folder', async () => {
        settings.getSettings.mockReturnValue({ library: { folders: ['/link', '/music/albums', '/music'] } })
        folders.validate.mockResolvedValue([
            { path: '/link', canonicalPath: '/music', available: true },
            {
                path: '/music/albums',
                canonicalPath: '/music/albums',
                available: true,
                nestedUnder: '/music',
            },
            { path: '/music', canonicalPath: '/music', available: true, nestedUnder: '/music' },
        ])

        const status = await service.startScan('startup')

        expect(backend.scan).toHaveBeenCalledWith(['/music'], expect.anything())
        expect(status.scannedFolders).toEqual(['/music'])
    })

    it('a background startup rescan attaches to the active scan', async () => {
        const first = await service.startScan('manual', ['/music'])
        const second = await service.startScan('startup')

        expect(second).toBe(first)
        expect(backend.scan).toHaveBeenCalledTimes(1)
    })

    it('a user-initiated scan takes over the running scan', async () => {
        const running = await service.startScan('startup')
        const runningSignal = backend.scan.mock.calls[0][1] as AbortSignal
        const aborted = new Promise<void>(resolve => runningSignal.addEventListener('abort', () => resolve()))

        const takeover = service.startScan('manual', ['/other'])
        await aborted
        // The real engine unwinds its stream once aborted; the restart gets a fresh one.
        const abortedUpdates$ = updates$
        updates$ = new Subject<LibraryScanUpdate>()
        abortedUpdates$.complete()
        const second = await takeover

        expect(running.phase).toBe('cancelled')
        expect(second.scanId).not.toBe(running.scanId)
        expect(second.phase).toBe('discovering')
        expect(backend.scan).toHaveBeenCalledTimes(2)
        expect(backend.scan).toHaveBeenLastCalledWith(['/other'], expect.anything())
    })

    it('a cancel during folder validation is not lost', async () => {
        let releaseValidation = (): void => undefined
        const validationStarted = new Promise<void>(started => {
            folders.validate.mockImplementation(
                () =>
                    new Promise(resolve => {
                        releaseValidation = () => resolve([availableFolder('/music')])
                        started()
                    }),
            )
        })

        const starting = service.startScan('manual', ['/music'])
        await validationStarted
        service.cancel()
        releaseValidation()
        const status = await starting

        expect(status.phase).toBe('cancelled')
        expect(status.terminal).toMatchObject({ outcome: 'cancelled', error: null })
        expect(backend.scan).not.toHaveBeenCalled()
    })

    it('a completed scan produces a full terminal result and persists only the aggregate', async () => {
        const status = await service.startScan('onboarding', ['/music'])

        updates$.next({ phase: 'discovery', discovered: 3, new: 2, changed: 0, unchanged: 1 })
        // Failure during discovery…
        updates$.next({ phase: 'itemError', path: '/music/locked.flac', error: 'EACCES' })
        updates$.next({ phase: 'started', total: 2 })
        // …and a failure during the read phase stay separately counted.
        updates$.next({
            phase: 'itemError',
            path: '/music/corrupt.mp3',
            code: 'PARSE_FAILED',
            error: 'bad frame',
        })
        updates$.next({ phase: 'progress', done: 2, total: 2 })
        updates$.next({
            phase: 'completed',
            count: 1,
            total: 3,
            unchanged: 1,
            changed: 0,
            new: 2,
            missing: 0,
            errors: 2,
        })
        updates$.complete()

        expect(status.phase).toBe('completed')
        expect(status.terminal).toMatchObject({
            outcome: 'completed',
            discovered: 3,
            discoveryFailureCount: 1,
            readFailureCount: 1,
            failuresTruncated: false,
            error: null,
        })
        expect(status.terminal?.failures).toEqual([
            { stage: 'discovery', path: '/music/locked.flac', message: 'EACCES' },
            { stage: 'read', path: '/music/corrupt.mp3', code: 'PARSE_FAILED', message: 'bad frame' },
        ])
        // Persisted: aggregate only, never the failure details.
        expect(stateStore.get('lastScan')).toMatchObject({ total: 3, errors: 2 })
        expect(JSON.stringify(stateStore.get('lastScan'))).not.toContain('corrupt.mp3')
    })

    it('an aborted scan terminates as cancelled, not failed', async () => {
        const status = await service.startScan('onboarding', ['/music'])
        updates$.next({ phase: 'discovery', discovered: 5, new: 5, changed: 0, unchanged: 0 })

        service.cancel()
        updates$.complete() // aborted scans complete without a `completed` update

        expect(status.phase).toBe('cancelled')
        expect(status.terminal).toMatchObject({ outcome: 'cancelled', error: null })
        expect(stateStore.get('lastScan')).toBeUndefined()
    })

    it('a stream error terminates as failed with a structured error', async () => {
        const status = await service.startScan('onboarding', ['/music'])

        updates$.error(new Error('engine exploded'))

        expect(status.phase).toBe('failed')
        expect(status.terminal).toMatchObject({
            outcome: 'failed',
            error: { code: 'SCAN_ERROR', message: 'engine exploded' },
        })
    })

    it('bumps the revision monotonically with every mutation', async () => {
        const status = await service.startScan('onboarding', ['/music'])
        const initial = status.revision

        updates$.next({ phase: 'discovery', discovered: 1, new: 1, changed: 0, unchanged: 0 })
        const afterDiscovery = status.revision
        updates$.next({ phase: 'started', total: 1 })

        expect(afterDiscovery).toBeGreaterThan(initial)
        expect(status.revision).toBeGreaterThan(afterDiscovery)
    })

    it('a new scan can start after the previous one terminated', async () => {
        await service.startScan('onboarding', ['/music'])
        updates$.complete() // terminates (cancelled/failed path)

        updates$ = new Subject<LibraryScanUpdate>()
        const second = await service.startScan('manual', ['/music'])

        expect(second.phase).toBe('discovering')
        expect(backend.scan).toHaveBeenCalledTimes(2)
    })
})
