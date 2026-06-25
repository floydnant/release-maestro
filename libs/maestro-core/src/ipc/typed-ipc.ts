/**
 * Electron-aware typed wrappers over `ipcRenderer` / `ipcMain` / `WebContents`.
 *
 * Each wrapper is parameterised by two contracts:
 *  - `TIncoming` — channels *this* side handles / listens for.
 *  - `TOutgoing` — channels the *other* side handles (i.e. what this side calls/emits).
 *
 * The wrappers are interfaces over the real Electron objects; a call site obtains
 * one with an `as unknown as` cast (see the `asApp*` helpers in `app-ipc.contract.ts`).
 * The cast narrows the surface to exactly the contract, so any off-contract channel,
 * payload, or return type becomes a compile error.
 *
 * This is the only file in the core library that references Electron; the import is
 * type-only and erased at runtime.
 */
import type { IpcMainEvent, IpcMainInvokeEvent, IpcRendererEvent, WebContents } from 'electron'
import type {
    EventChannels,
    IpcContract,
    PayloadArgs,
    PayloadOf,
    RequestChannels,
    ResponseOf,
} from './ipc-contract'

/** Renderer-side `ipcRenderer`, constrained to the app's IPC contracts. */
export interface TypedIpcRenderer<TIncoming extends IpcContract, TOutgoing extends IpcContract> {
    invoke<K extends RequestChannels<TOutgoing>>(
        channel: K,
        ...args: PayloadArgs<PayloadOf<TOutgoing[K]>>
    ): Promise<ResponseOf<TOutgoing[K]>>

    send<K extends EventChannels<TOutgoing>>(channel: K, ...args: PayloadArgs<PayloadOf<TOutgoing[K]>>): void

    on<K extends EventChannels<TIncoming>>(
        channel: K,
        listener: (event: IpcRendererEvent, ...args: PayloadArgs<PayloadOf<TIncoming[K]>>) => void,
    ): this

    off<K extends EventChannels<TIncoming>>(
        channel: K,
        listener: (event: IpcRendererEvent, ...args: PayloadArgs<PayloadOf<TIncoming[K]>>) => void,
    ): this

    once<K extends EventChannels<TIncoming>>(
        channel: K,
        listener: (event: IpcRendererEvent, ...args: PayloadArgs<PayloadOf<TIncoming[K]>>) => void,
    ): this
}

/** Main-process `ipcMain`, constrained to the app's IPC contracts. */
export interface TypedIpcMain<TIncoming extends IpcContract, TOutgoing extends IpcContract> {
    /**
     * Phantom marker for the renderer-facing contract this process emits to.
     * Emitting is done per-`WebContents` via {@link TypedWebContents} (see
     * `toRendererEmitter`), not through `ipcMain`, so this never exists at runtime.
     */
    readonly __emits?: TOutgoing

    handle<K extends RequestChannels<TIncoming>>(
        channel: K,
        listener: (
            event: IpcMainInvokeEvent,
            ...args: PayloadArgs<PayloadOf<TIncoming[K]>>
        ) => ResponseOf<TIncoming[K]> | Promise<ResponseOf<TIncoming[K]>>,
    ): void

    on<K extends EventChannels<TIncoming>>(
        channel: K,
        listener: (event: IpcMainEvent, ...args: PayloadArgs<PayloadOf<TIncoming[K]>>) => void,
    ): this

    once<K extends EventChannels<TIncoming>>(
        channel: K,
        listener: (event: IpcMainEvent, ...args: PayloadArgs<PayloadOf<TIncoming[K]>>) => void,
    ): this

    removeListener<K extends EventChannels<TIncoming>>(
        channel: K,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        listener: (...args: any[]) => void,
    ): this
}

/** Typed view of a `WebContents` for emitting main -> renderer events. */
export interface TypedWebContents<TOutgoing extends IpcContract> {
    send<K extends EventChannels<TOutgoing>>(channel: K, ...args: PayloadArgs<PayloadOf<TOutgoing[K]>>): void
}

/** Narrow a `WebContents` (e.g. `event.sender`) to the renderer-facing contract. */
export const toTypedWebContents = <TOutgoing extends IpcContract>(
    webContents: WebContents,
): TypedWebContents<TOutgoing> => webContents as unknown as TypedWebContents<TOutgoing>
