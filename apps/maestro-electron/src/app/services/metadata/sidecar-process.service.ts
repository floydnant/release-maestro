import { ChildProcessWithoutNullStreams, spawn } from 'child_process'
import { randomUUID } from 'crypto'
import { createInterface, Interface } from 'readline'
import {
    MetadataEvent,
    MetadataMethod,
    MetadataRequest,
    MetadataResponse,
    MetadataWorkerMessage,
} from '@release-maestro/core'
import { PROVIDER_DESTROY } from '../../utils/dependency-injection.util'
import { createMainLogger, isDebugLoggingEnabled, writeDiagnosticEntry } from '../../logging/logger'
import { diagnosticEntry } from '@release-maestro/core'

const log = createMainLogger('metadata-worker')

type EventListener = (event: MetadataEvent) => void

interface PendingRequest {
    resolve: (response: MetadataResponse) => void
    reject: (error: Error) => void
    onEvent?: EventListener
}

/**
 * Manages the long-lived `metadata-engine` Rust worker process and the JSON Lines
 * protocol over its stdio:
 * - stdin  ← requests (one compact JSON object per line)
 * - stdout → responses / events (parsed line-by-line, correlated by request id)
 * - stderr → structured diagnostic logs (written by the main process)
 *
 * The worker handles one operation at a time; this class simply correlates each
 * response/event back to its originating request id. The process is spawned lazily
 * and respawned on the next request if it has exited.
 */
export class SidecarProcessService {
    private process: ChildProcessWithoutNullStreams | null = null
    private readline: Interface | null = null
    private stderrReadline: Interface | null = null
    private readonly pending = new Map<string, PendingRequest>()

    constructor(private readonly binaryPath: string) {}

    private ensureStarted(): ChildProcessWithoutNullStreams {
        if (this.process && this.process.exitCode == null && !this.process.killed) {
            return this.process
        }

        const child = spawn(
            this.binaryPath,
            ['--jsonl', '--log-level', isDebugLoggingEnabled() ? 'debug' : 'info'],
            { stdio: ['pipe', 'pipe', 'pipe'] },
        )
        this.process = child
        log.info('worker.started', { pid: child.pid ?? 0 })

        this.readline = createInterface({ input: child.stdout })
        this.readline.on('line', line => this.handleLine(line))

        this.stderrReadline = createInterface({ input: child.stderr })
        this.stderrReadline.on('line', line => this.handleStderrLine(line))

        child.on('error', error => {
            log.error('worker.process.error', error)
            this.handleExit(new Error(`metadata-engine failed to start: ${error.message}`))
        })
        child.on('close', (code, signal) => {
            if (this.process !== child) return
            const fields = { exitCode: code ?? -1, signal: signal ?? 'none' }
            if (code === 0) log.info('worker.exited', fields)
            else log.warn('worker.exited', fields)
            this.handleExit(
                new Error(`metadata-engine exited (code=${code ?? 'null'}, signal=${signal ?? 'null'})`),
            )
        })

        return child
    }

    private handleStderrLine(line: string): void {
        if (!line.trim()) return
        try {
            const record: unknown = JSON.parse(line)
            if (record && typeof record === 'object' && 'level' in record && 'fields' in record) {
                const level = String(record.level).toLowerCase()
                const fields = record.fields
                if (!fields || typeof fields !== 'object') throw new Error('Invalid worker log fields')
                const values = fields as Record<string, unknown>
                const event = typeof values['message'] === 'string' ? values['message'] : 'worker.message'
                const details = {
                    ...(typeof values['error'] === 'string' ? { errorMessage: values['error'] } : {}),
                    ...(typeof values['request_id'] === 'string' ? { requestId: values['request_id'] } : {}),
                }
                writeDiagnosticEntry(
                    diagnosticEntry(
                        level === 'error'
                            ? 'error'
                            : level === 'warn'
                              ? 'warn'
                              : level === 'debug' || level === 'trace'
                                ? 'debug'
                                : 'info',
                        'metadata-worker',
                        event,
                        details,
                    ),
                    'worker',
                )
                return
            }
        } catch {
            // Panic output and older workers can write plain stderr. The shared sanitizer removes paths.
        }
        log.warn('worker.stderr.unstructured', { lineLength: line.length })
    }

    private handleLine(line: string): void {
        const trimmed = line.trim()
        if (!trimmed) return

        let message: MetadataWorkerMessage
        try {
            message = JSON.parse(trimmed) as MetadataWorkerMessage
        } catch {
            log.error('worker.protocol.invalid-json', new Error('Invalid worker protocol JSON'), {
                lineLength: trimmed.length,
            })
            return
        }

        if (message.type == 'event') {
            this.pending.get(message.requestId)?.onEvent?.(message)
            return
        }

        if (message.type == 'response') {
            const pending = this.pending.get(message.id)
            if (!pending) return
            this.pending.delete(message.id)
            pending.resolve(message)
        }
    }

    private handleExit(error: Error): void {
        this.readline?.close()
        this.readline = null
        this.stderrReadline?.close()
        this.stderrReadline = null
        this.process = null

        if (this.pending.size > 0) {
            log.error('worker.request.interrupted', error, { pendingRequests: this.pending.size })
        }

        // Fail any in-flight requests so callers don't hang forever.
        for (const [, pending] of this.pending) pending.reject(error)
        this.pending.clear()
    }

    /**
     * Sends a request and resolves with the worker's terminal response. Optional
     * `onEvent` receives any events emitted before the terminal response. The
     * generated request `id` is returned so the caller can issue a `cancel`.
     */
    startRequest<TResult>(
        method: MetadataMethod,
        params: unknown,
        onEvent?: EventListener,
    ): { id: string; done: Promise<MetadataResponse<TResult>> } {
        const id = randomUUID()
        const done = new Promise<MetadataResponse<TResult>>((resolve, reject) => {
            let child: ChildProcessWithoutNullStreams
            try {
                child = this.ensureStarted()
            } catch (error) {
                reject(error instanceof Error ? error : new Error(String(error)))
                return
            }

            this.pending.set(id, {
                resolve: resolve as (response: MetadataResponse) => void,
                reject,
                onEvent,
            })

            const request: MetadataRequest = { type: 'request', id, method, params }
            child.stdin.write(`${JSON.stringify(request)}\n`, error => {
                if (error) {
                    this.pending.delete(id)
                    reject(error)
                }
            })
        })

        return { id, done }
    }

    /** Convenience for one-shot requests with no streamed events. */
    send<TResult>(method: MetadataMethod, params: unknown): Promise<MetadataResponse<TResult>> {
        return this.startRequest<TResult>(method, params).done
    }

    stop(): void {
        this.readline?.close()
        this.readline = null
        this.stderrReadline?.close()
        this.stderrReadline = null
        for (const [, pending] of this.pending) {
            pending.reject(new Error('metadata-engine is shutting down'))
        }
        this.pending.clear()

        // Closing stdin lets the worker drain and exit cleanly.
        this.process?.stdin.end()
        this.process?.kill()
        this.process = null
    }

    [PROVIDER_DESTROY](): void {
        this.stop()
    }
}
