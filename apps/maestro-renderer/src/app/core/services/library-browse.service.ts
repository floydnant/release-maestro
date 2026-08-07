import { inject, Injectable } from '@angular/core'
import {
    LibraryBrowseIpcChannel,
    type AlbumDetailResult,
    type AlbumFilter,
    type AlbumFilterDescription,
    type AlbumQuery,
    type AlbumWindowResult,
    type BrowseWindow,
    type SongFilter,
    type SongFilterDescription,
    type SongQuery,
    type SongWindowResult,
} from '@release-maestro/core'
import { ElectronService } from './electron/electron.service'

const EMPTY_FILTER_DESCRIPTION: SongFilterDescription = {
    artists: [],
    genres: [],
    recordLabels: [],
    albums: [],
}

const EMPTY_ALBUM_FILTER_DESCRIPTION: AlbumFilterDescription = {
    albumArtists: [],
    recordLabels: [],
    genres: [],
}

/**
 * Renderer-side entry to the library read side.
 *
 * Deliberately thin: one-shot request/response per ADR 0004, with no caching and no
 * state of its own. Deciding *which* window is still wanted is the browse query
 * primitive's job (`shared/browse/browse-query.ts`), and a service that also cached
 * would put that decision in two places.
 *
 * Outside Electron — the renderer E2E harness aside, which mocks `ipcRenderer`
 * itself — there is no main process to ask, so these resolve to an empty catalog
 * rather than throwing.
 */
@Injectable({ providedIn: 'root' })
export class LibraryBrowseService {
    private electronService = inject(ElectronService)

    querySongs(query: SongQuery, window: BrowseWindow): Promise<SongWindowResult> {
        if (!this.electronService.isElectron) {
            return Promise.resolve({ rows: [], offset: window.offset, total: 0 })
        }

        return this.electronService.ipcRenderer.invoke(LibraryBrowseIpcChannel.querySongs, {
            query,
            window,
        })
    }

    describeSongFilter(filter: SongFilter): Promise<SongFilterDescription> {
        if (!this.electronService.isElectron) return Promise.resolve(EMPTY_FILTER_DESCRIPTION)

        return this.electronService.ipcRenderer.invoke(LibraryBrowseIpcChannel.describeSongFilter, {
            filter,
        })
    }

    queryAlbums(query: AlbumQuery, window: BrowseWindow): Promise<AlbumWindowResult> {
        if (!this.electronService.isElectron) {
            return Promise.resolve({ rows: [], offset: window.offset, total: 0 })
        }

        return this.electronService.ipcRenderer.invoke(LibraryBrowseIpcChannel.queryAlbums, {
            query,
            window,
        })
    }

    describeAlbumFilter(filter: AlbumFilter): Promise<AlbumFilterDescription> {
        if (!this.electronService.isElectron) return Promise.resolve(EMPTY_ALBUM_FILTER_DESCRIPTION)

        return this.electronService.ipcRenderer.invoke(LibraryBrowseIpcChannel.describeAlbumFilter, {
            filter,
        })
    }

    /** `null` for an album that no longer exists — a stale link, or a rescan that re-keyed it. */
    getAlbumDetail(albumId: string): Promise<AlbumDetailResult> {
        if (!this.electronService.isElectron) return Promise.resolve(null)

        return this.electronService.ipcRenderer.invoke(LibraryBrowseIpcChannel.getAlbumDetail, { albumId })
    }
}
