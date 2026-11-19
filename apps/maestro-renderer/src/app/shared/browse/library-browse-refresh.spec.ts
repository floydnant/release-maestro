import { signal } from '@angular/core'
import { TestBed } from '@angular/core/testing'
import type { LibraryScanStatus } from '@release-maestro/core'
import { LibraryService } from '../../core/services/library.service'
import { createBrowseQuery } from './browse-query'
import { libraryBrowseRefresh } from './library-browse-refresh'

const terminalStatus = (scanId: number, phase: LibraryScanStatus['phase']): LibraryScanStatus => ({
    scanId,
    revision: 10,
    trigger: 'manual',
    phase,
    scannedFolders: ['/music'],
    unavailableFolders: [],
    startedAt: 1_000,
    finishedAt: 1_100,
    discovered: 1,
    new: 0,
    changed: 0,
    unchanged: 1,
    readDone: 1,
    readTotal: 1,
    refreshTotal: 0,
    imported: 1,
    failedFiles: 0,
    coverFailureCount: 0,
    normalizationIssues: 0,
    terminal: null,
})

const settle = async () => {
    TestBed.tick()
    await Promise.resolve()
    await Promise.resolve()
    TestBed.tick()
}

describe('libraryBrowseRefresh', () => {
    it.each(['completed', 'cancelled', 'failed'] satisfies LibraryScanStatus['phase'][])(
        'refreshes repaired artwork when consecutive scans are only observed as %s',
        async phase => {
            const scanStatus = signal<LibraryScanStatus | null>(terminalStatus(1, phase))
            TestBed.configureTestingModule({
                providers: [{ provide: LibraryService, useValue: { scanStatus } }],
            })
            let coverPath: string | null = null
            const fetchWindow = jest.fn(async () => ({
                rows: [{ id: 'album', coverPath }],
                offset: 0,
                total: 1,
            }))
            const browse = TestBed.runInInjectionContext(() =>
                createBrowseQuery({
                    query: signal({}),
                    viewport: signal({ offset: 0, limit: 20 }),
                    refresh: libraryBrowseRefresh(),
                    fetchWindow,
                }),
            )
            await settle()
            expect(browse.result().rows).toEqual([{ id: 'album', coverPath: null }])

            coverPath = '/cache/repaired.png'
            // A short scan can finish between broadcasts, with no active phase observed.
            scanStatus.set(terminalStatus(2, phase))
            await settle()
            expect(browse.result().rows).toEqual([{ id: 'album', coverPath }])

            const requests = fetchWindow.mock.calls.length
            scanStatus.set({ ...terminalStatus(2, phase), revision: 11 })
            await settle()
            expect(fetchWindow).toHaveBeenCalledTimes(requests)
        },
    )
})
