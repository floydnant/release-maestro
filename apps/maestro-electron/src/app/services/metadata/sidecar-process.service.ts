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
 * - stderr → diagnostic logs (forwarded to the console)
 *
 * The worker handles one operation at a time; this class simply correlates each
 * response/event back to its originating request id. The process is spawned lazily
 * and respawned on the next request if it has exited.
 */
export class SidecarProcessService {
    private process: ChildProcessWithoutNullStreams | null = null
    private readline: Interface | null = null
    private readonly pending = new Map<string, PendingRequest>()

    constructor(private readonly binaryPath: string) {}

    private ensureStarted(): ChildProcessWithoutNullStreams {
        if (this.process && this.process.exitCode == null && !this.process.killed) {
            return this.process
        }

        const child = spawn(this.binaryPath, ['--jsonl'], { stdio: ['pipe', 'pipe', 'pipe'] })
        this.process = child

        this.readline = createInterface({ input: child.stdout })
        this.readline.on('line', line => this.handleLine(line))

        child.stderr.on('data', (chunk: Buffer) => {
            const text = chunk.toString().trimEnd()
            if (text) console.error(`[metadata-engine] ${text}`)
        })

        child.on('error', error =>
            this.handleExit(new Error(`metadata-engine failed to start: ${error.message}`)),
        )
        child.on('exit', (code, signal) => {
            this.handleExit(
                new Error(`metadata-engine exited (code=${code ?? 'null'}, signal=${signal ?? 'null'})`),
            )
        })

        return child
    }

    private handleLine(line: string): void {
        const trimmed = line.trim()
        if (!trimmed) return

        let message: MetadataWorkerMessage
        try {
            message = JSON.parse(trimmed) as MetadataWorkerMessage
        } catch {
            console.error(`[metadata-engine] unparseable protocol line: ${trimmed}`)
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
        this.process = null

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
