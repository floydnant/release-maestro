import { TestBed } from '@angular/core/testing'
import {
    LibraryIpcChannel,
    LibraryScanSnapshot,
    LibraryScanStatus,
    LibraryScanStatusEvent,
} from '@release-maestro/core'
import { ElectronService } from './electron/electron.service'
import { LibraryService } from './library.service'

const status = (
    scanId: number,
    revision: number,
    overrides: Partial<LibraryScanStatus> = {},
): LibraryScanStatus => ({
    scanId,
    revision,
    trigger: 'startup',
    phase: 'reading',
    scannedFolders: ['/music'],
    startedAt: 1_000,
    finishedAt: null,
    discovered: 0,
    new: 0,
    changed: 0,
    unchanged: 0,
    readDone: 0,
    readTotal: 10,
    imported: 0,
    failedFiles: 0,
    normalizationIssues: 0,
    terminal: null,
    ...overrides,
})

const album = (coverPath: string) => ({ albumTitle: null, artist: null, coverPath })

describe('LibraryService snapshot/event ordering', () => {
    let pushEvent: (event: LibraryScanStatusEvent) => void
    let resolveSnapshot: (snapshot: LibraryScanSnapshot) => void

    const ipcRenderer = {
        on: jest.fn((_channel: string, handler: (event: unknown, payload: unknown) => void) => {
            pushEvent = statusEvent => handler({}, statusEvent)
        }),
        off: jest.fn(),
        send: jest.fn(),
        invoke: jest.fn((channel: string) => {
            if (channel === LibraryIpcChannel.getScanStatus) {
                return new Promise<LibraryScanSnapshot>(resolve => {
                    resolveSnapshot = resolve
                })
            }
            return Promise.resolve(undefined)
        }),
    }

    const setup = () => {
        TestBed.configureTestingModule({
            providers: [{ provide: ElectronService, useValue: { isElectron: true, ipcRenderer } }],
        })
        return TestBed.inject(LibraryService)
    }

    beforeEach(() => {
        ipcRenderer.invoke.mockClear()
    })

    it('applies a snapshot that arrives before any push event', async () => {
        const service = setup()

        resolveSnapshot({
            status: status(1, 5),
            albums: [album('/covers/a'), album('/covers/b')],
            lastScan: null,
        })
        await service.synced

        expect(service.scanStatus()?.revision).toBe(5)
        expect(service.mosaicAlbums().map(a => a.coverPath)).toEqual(['/covers/a', '/covers/b'])
    })

    it('applies a push event that arrives before the snapshot resolves', () => {
        const service = setup()

        pushEvent({ status: status(1, 3), newAlbums: [album('/covers/a')] })

        expect(service.scanStatus()?.revision).toBe(3)
        expect(service.mosaicAlbums()).toHaveLength(1)
    })

    it('rejects a stale snapshot that resolves after a newer event, but keeps its lastScan', async () => {
        const service = setup()

        pushEvent({ status: status(1, 7), newAlbums: [album('/covers/a')] })
        resolveSnapshot({
            status: status(1, 2),
            albums: [],
            lastScan: { count: 1, total: 1, finishedAt: 500, scannedFolders: ['/music'] },
        })
        await service.synced

        // Status/mosaic kept from the newer event…
        expect(service.scanStatus()?.revision).toBe(7)
        expect(service.mosaicAlbums()).toHaveLength(1)
        // …while the (status-independent) persisted aggregate still applied.
        expect(service.lastScan()?.finishedAt).toBe(500)
    })

    it('applies a newer snapshot even though an older push event was received first', async () => {
        const service = setup()

        pushEvent({ status: status(1, 2), newAlbums: [album('/covers/a')] })
        resolveSnapshot({
            status: status(1, 9, { readDone: 9 }),
            albums: [album('/covers/a'), album('/covers/b')],
            lastScan: null,
        })
        await service.synced

        expect(service.scanStatus()?.readDone).toBe(9)
        expect(service.mosaicAlbums().map(a => a.coverPath)).toEqual(['/covers/a', '/covers/b'])
    })

    it('rejects push events from an older scan', () => {
        const service = setup()

        pushEvent({ status: status(2, 1), newAlbums: [] })
        pushEvent({ status: status(1, 99), newAlbums: [album('/covers/stale')] })

        expect(service.scanStatus()?.scanId).toBe(2)
        expect(service.mosaicAlbums()).toHaveLength(0)
    })

    it('moving to a new scan resets the mosaic exactly once and re-dedupes covers', () => {
        const service = setup()

        pushEvent({ status: status(1, 1), newAlbums: [album('/covers/a')] })
        pushEvent({ status: status(2, 1), newAlbums: [album('/covers/a')] })

        // Reset on the scan transition, then the same cover may reappear once.
        expect(service.scanStatus()?.scanId).toBe(2)
        expect(service.mosaicAlbums().map(a => a.coverPath)).toEqual(['/covers/a'])

        // Replayed deltas within the same scan stay deduped.
        pushEvent({ status: status(2, 2), newAlbums: [album('/covers/a'), album('/covers/b')] })
        expect(service.mosaicAlbums().map(a => a.coverPath)).toEqual(['/covers/a', '/covers/b'])
    })

    it('applies same-revision snapshots (equal is not stale)', () => {
        const service = setup()

        pushEvent({ status: status(1, 4), newAlbums: [] })
        pushEvent({ status: status(1, 4, { readDone: 4 }), newAlbums: [] })

        expect(service.scanStatus()?.readDone).toBe(4)
    })

    it('canonicalizes and deduplicates every folder source before persisting', async () => {
        ipcRenderer.invoke.mockImplementation((channel: string) => {
            if (channel === LibraryIpcChannel.getScanStatus) {
                return new Promise<LibraryScanSnapshot>(resolve => {
                    resolveSnapshot = resolve
                })
            }
            if (channel === LibraryIpcChannel.validateFolders) {
                return Promise.resolve([
                    { path: '/link', canonicalPath: '/music', available: true },
                    { path: '/music', canonicalPath: '/music', available: true },
                    {
                        path: '/offline',
                        canonicalPath: '/offline',
                        available: false,
                        error: 'Folder not found',
                    },
                ])
            }
            if (channel === 'patch-settings') {
                return Promise.resolve({
                    library: { folders: ['/music', '/offline'] },
                    emailPluginConfig: {},
                })
            }
            return Promise.resolve(undefined)
        })
        const service = setup()
        resolveSnapshot({ status: null, albums: [], lastScan: null })
        await service.synced

        await service.saveFolders(['/link', '/music', '/offline'])

        expect(ipcRenderer.invoke).toHaveBeenCalledWith('patch-settings', {
            library: { folders: ['/music', '/offline'] },
        })
    })
})
