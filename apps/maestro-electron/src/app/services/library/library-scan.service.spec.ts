import { Subject } from 'rxjs'
import { LibraryRootValidation, LibraryScanUpdate } from '@release-maestro/core'
import { InMemoryStore } from '../../utils/persistent-store.util'
import { SettingsBackendService } from '../settings.backend.service'
import { LibraryRootsService } from './library-roots.service'
import { LibraryScanService, LibraryScanState } from './library-scan.service'
import { LibraryBackendService } from './library.backend.service'

jest.mock('electron', () => ({
    BrowserWindow: { getAllWindows: () => [] },
}))

const availableRoot = (path: string): LibraryRootValidation => ({
    path,
    canonicalPath: path,
    available: true,
})

describe('LibraryScanService', () => {
    let updates$: Subject<LibraryScanUpdate>
    let backend: { scan: jest.Mock }
    let roots: { validate: jest.Mock }
    let settings: { getSettings: jest.Mock }
    let stateStore: InMemoryStore<LibraryScanState>
    let service: LibraryScanService

    beforeEach(() => {
        jest.useFakeTimers()
        updates$ = new Subject<LibraryScanUpdate>()
        backend = { scan: jest.fn(() => updates$.asObservable()) }
        roots = {
            validate: jest.fn((paths: string[]) => Promise.resolve(paths.map(availableRoot))),
        }
        settings = { getSettings: jest.fn(() => ({ libraryFolders: ['/music'] })) }
        stateStore = new InMemoryStore<LibraryScanState>()
        service = new LibraryScanService(
            backend as unknown as LibraryBackendService,
            settings as unknown as SettingsBackendService,
            roots as unknown as LibraryRootsService,
            stateStore,
        )
    })

    afterEach(() => {
        jest.useRealTimers()
    })

    it('stays idle for empty roots and never touches the pipeline', async () => {
        settings.getSettings.mockReturnValue({ libraryFolders: [] })

        const status = await service.startScan('startup')

        expect(status.phase).toBe('idle')
        expect(roots.validate).not.toHaveBeenCalled()
        expect(backend.scan).not.toHaveBeenCalled()
    })

    it('fails up front when any root is unavailable — no partial scan', async () => {
        settings.getSettings.mockReturnValue({ libraryFolders: ['/music', '/usb/drive'] })
        roots.validate.mockResolvedValue([
            availableRoot('/music'),
            { path: '/usb/drive', canonicalPath: '/usb/drive', available: false, error: 'not found' },
        ])

        const status = await service.startScan('startup')

        expect(backend.scan).not.toHaveBeenCalled()
        expect(status.phase).toBe('failed')
        expect(status.terminal).toMatchObject({
            outcome: 'failed',
            error: { code: 'ROOTS_UNAVAILABLE', unavailableRoots: ['/usb/drive'] },
        })
        // Nothing persisted for a failed scan.
        expect(stateStore.get('lastScan')).toBeUndefined()
    })

    it('scans canonical roots and omits roots nested under another root', async () => {
        settings.getSettings.mockReturnValue({ libraryFolders: ['/link', '/music/albums', '/music'] })
        roots.validate.mockResolvedValue([
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
        expect(status.roots).toEqual(['/music'])
    })

    it('concurrent starts attach to the active scan', async () => {
        const first = await service.startScan('startup')
        const second = await service.startScan('manual', ['/other'])

        expect(second).toBe(first)
        expect(backend.scan).toHaveBeenCalledTimes(1)
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
