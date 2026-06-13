import { Observable } from 'rxjs'
import {
    MetadataEvent,
    MetadataProtocolError,
    MetadataResponse,
    MetadataScanUpdate,
    PingResult,
    ScanItemData,
    ScanItemErrorData,
    ScanProgressData,
    ScanResult,
    ScanStartedData,
    SongMetadata,
    SongMetadataUpdate,
} from '@release-maestro/core'
import { SidecarProcessService } from './sidecar-process.service'

/** Thrown when the worker returns a structured (`ok: false`) error response. */
export class MetadataEngineException extends Error {
    constructor(
        public readonly code: MetadataProtocolError['code'],
        message: string,
        public readonly details?: unknown,
    ) {
        super(message)
        this.name = 'MetadataEngineException'
    }
}

const unwrap = <TResult>(response: MetadataResponse<TResult>): TResult => {
    if (response.ok) return response.result as TResult
    const error = response.error ?? { code: 'INTERNAL_ERROR' as const, message: 'Unknown engine error' }
    throw new MetadataEngineException(error.code, error.message, error.details)
}

const translateScanEvent = (event: MetadataEvent): MetadataScanUpdate => {
    switch (event.event) {
        case 'started':
            return { phase: 'started', total: (event.data as ScanStartedData).total }
        case 'progress': {
            const { done, total } = event.data as ScanProgressData
            return { phase: 'progress', done, total }
        }
        case 'item':
            return { phase: 'item', metadata: (event.data as ScanItemData).metadata }
        case 'item_error': {
            const { path, error } = event.data as ScanItemErrorData
            return { phase: 'itemError', path, error }
        }
    }
}

/**
 * Typed, app-facing API over the {@link SidecarProcessService}. Injects the cover-art
 * cache directory into every request and translates raw worker events into the
 * renderer-facing {@link MetadataScanUpdate} stream.
 */
export class MetadataBackendService {
    constructor(
        private readonly sidecar: SidecarProcessService,
        private readonly coverArtCacheDir: string,
    ) {}

    async ping(): Promise<PingResult> {
        return unwrap(await this.sidecar.send<PingResult>('ping', {}))
    }

    async readFile(path: string): Promise<SongMetadata | null> {
        const response = await this.sidecar.send<SongMetadata | null>('read_file', {
            path,
            coverArtCacheDir: this.coverArtCacheDir,
        })
        return unwrap(response)
    }

    async writeTags(path: string, update: SongMetadataUpdate): Promise<SongMetadata> {
        const response = await this.sidecar.send<SongMetadata>('write_tags', {
            path,
            update,
            coverArtCacheDir: this.coverArtCacheDir,
        })
        return unwrap(response)
    }

    /**
     * Scans the given paths, streaming per-file results and progress. Aborting the
     * signal sends a cooperative `cancel` to the worker for this scan.
     */
    scan(paths: string[], abortSignal?: AbortSignal): Observable<MetadataScanUpdate> {
        return new Observable<MetadataScanUpdate>(subscriber => {
            const { id, done } = this.sidecar.startRequest<ScanResult>(
                'scan',
                { paths, coverArtCacheDir: this.coverArtCacheDir },
                event => subscriber.next(translateScanEvent(event)),
            )

            const onAbort = () => void this.sidecar.send('cancel', { requestId: id })
            abortSignal?.addEventListener('abort', onAbort, { once: true })

            done.then(
                response => {
                    if (response.ok) {
                        const { count, total } = response.result as ScanResult
                        subscriber.next({ phase: 'completed', count, total })
                    } else {
                        subscriber.next({
                            phase: 'error',
                            error: response.error ?? {
                                code: 'INTERNAL_ERROR',
                                message: 'Unknown engine error',
                            },
                        })
                    }
                    subscriber.complete()
                },
                error => subscriber.error(error),
            )

            return () => abortSignal?.removeEventListener('abort', onAbort)
        })
    }
}
