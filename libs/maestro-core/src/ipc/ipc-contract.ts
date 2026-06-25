/**
 * Generic, transport-agnostic IPC contract layer.
 *
 * A *contract* is a map of channel name -> channel definition. Each definition
 * describes the channel by its *nature*, not by how it is called:
 *
 *  - {@link defineIpcRequest} — request/response. There is a response value the
 *    caller awaits. Registered on the handler with `.handle`, called with `.invoke`.
 *  - {@link defineIpcEvent} — fire-and-forget notification. No response, either
 *    direction. Registered with `.on`, emitted with `.send`.
 *
 * Both helpers return a small runtime object carrying `kind`, so the contract is
 * introspectable at runtime as well as in the type system. The payload/response
 * types live in the phantom generics and are recovered with {@link PayloadOf} /
 * {@link ResponseOf}.
 *
 * This file is intentionally free of any Electron dependency — see `typed-ipc.ts`
 * for the Electron-aware wrappers built on top of these primitives.
 */

/** A request/response channel: payload in, response out (both default to `void`). */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export interface IpcRequestDef<TPayload = void, TResponse = void> {
    kind: 'request'
}

/** A fire-and-forget channel: payload in, no response (payload defaults to `void`). */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export interface IpcEventDef<TPayload = void> {
    kind: 'event'
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type IpcChannelDef = IpcRequestDef<any, any> | IpcEventDef<any>

/** A full contract: every channel name mapped to its definition. */
export type IpcContract = Record<string, IpcChannelDef>

/** Declare a request/response channel. `defineIpcRequest<Payload, Response>()`. */
export const defineIpcRequest = <TPayload = void, TResponse = void>(): IpcRequestDef<
    TPayload,
    TResponse
> => ({ kind: 'request' })

/** Declare a fire-and-forget channel. `defineIpcEvent<Payload>()`. */
export const defineIpcEvent = <TPayload = void>(): IpcEventDef<TPayload> => ({ kind: 'event' })

/** Identity helper that preserves the literal channel keys while constraining values. */
export const defineIpcContract = <const TContract extends IpcContract>(contract: TContract): TContract =>
    contract

/** Recover the payload type from a channel definition. */
export type PayloadOf<TDef> =
    TDef extends IpcRequestDef<infer TPayload, infer _TResponse>
        ? TPayload
        : TDef extends IpcEventDef<infer TPayload>
          ? TPayload
          : never

/** Recover the response type from a channel definition (events resolve to `void`). */
export type ResponseOf<TDef> = TDef extends IpcRequestDef<infer _TPayload, infer TResponse> ? TResponse : void

/** A `void` payload becomes zero arguments; anything else becomes a single payload arg. */
export type PayloadArgs<TPayload> = [TPayload] extends [void] ? [] : [payload: TPayload]

/** Channel names in a contract that are request/response channels. */
export type RequestChannels<TContract extends IpcContract> = {
    [K in keyof TContract]: TContract[K] extends IpcRequestDef ? K : never
}[keyof TContract]

/** Channel names in a contract that are fire-and-forget channels. */
export type EventChannels<TContract extends IpcContract> = {
    [K in keyof TContract]: TContract[K] extends IpcEventDef ? K : never
}[keyof TContract]
