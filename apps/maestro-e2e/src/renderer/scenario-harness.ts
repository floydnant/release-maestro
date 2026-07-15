import { Page } from '@playwright/test'
import {
    AppSettings,
    FeedLoadError,
    HydratedFeedItem,
    MainIpcContract,
    RendererIpcContract,
} from '@release-maestro/core'

type MainIpcChannel = keyof MainIpcContract & string
type RendererIpcChannel = keyof RendererIpcContract & string

type IpcPayload = unknown
type ScenarioSerializedValue = string

export type IpcCall = {
    id: number
    channel: string
    payload: IpcPayload
}

export type ScenarioBehavior =
    | { kind: 'resolve'; value?: IpcPayload }
    | { kind: 'reject'; message: string; userFacingMessage?: string }
    | { kind: 'pending' }
    | { kind: 'sequence'; steps: ScenarioBehavior[]; fallback?: ScenarioBehavior }

export type RendererScenario = {
    handlers: Record<string, ScenarioBehavior>
}

type ScenarioState = {
    handlers: Record<string, ScenarioBehavior>
    calls: IpcCall[]
    nextCallId: number
    pending: Record<
        string,
        {
            callId: number
            channel: string
            resolve: (value?: unknown) => void
        }[]
    >
}

declare global {
    interface Window {
        process?: {
            type?: string
            platform?: string
        }
        require?: (moduleName: string) => unknown
        __maestroScenario: {
            calls: (channel?: string) => IpcCall[]
            lastCall: (channel: string) => IpcCall | undefined
            setHandler: (channel: string, behavior: ScenarioBehavior) => void
            resolvePending: (channel: string, value?: IpcPayload) => void
            emit: (channel: string, payload?: IpcPayload) => void
            deserialize: (value: ScenarioSerializedValue) => unknown
            serialize: (value: unknown) => ScenarioSerializedValue
        }
    }
}

const SCENARIO_SERIALIZED_TYPE_KEY = '__maestroScenarioSerializedType'
const SCENARIO_SERIALIZED_DATE_TYPE = 'Date'
const SCENARIO_SERIALIZED_UNDEFINED_TYPE = 'Undefined'

const isRecord = (value: unknown): value is Record<string, unknown> =>
    typeof value == 'object' && value != null

const originalJsonValue = (holder: unknown, key: string, value: unknown): unknown => {
    if (!isRecord(holder)) return value
    return Object.prototype.hasOwnProperty.call(holder, key) ? holder[key] : value
}

const scenarioJsonReplacer = function (this: unknown, key: string, value: unknown): unknown {
    const originalValue = originalJsonValue(this, key, value)

    if (originalValue instanceof Date) {
        return {
            [SCENARIO_SERIALIZED_TYPE_KEY]: SCENARIO_SERIALIZED_DATE_TYPE,
            value: originalValue.toISOString(),
        }
    }
    if (typeof value == 'undefined') {
        return { [SCENARIO_SERIALIZED_TYPE_KEY]: SCENARIO_SERIALIZED_UNDEFINED_TYPE }
    }
    return value
}

const isSerializedDate = (value: unknown): value is { value: string } =>
    isRecord(value) &&
    value[SCENARIO_SERIALIZED_TYPE_KEY] === SCENARIO_SERIALIZED_DATE_TYPE &&
    typeof value['value'] == 'string'
const isSerializedUndefined = (value: unknown): boolean =>
    isRecord(value) && value[SCENARIO_SERIALIZED_TYPE_KEY] === SCENARIO_SERIALIZED_UNDEFINED_TYPE

const scenarioJsonReviver = (_key: string, value: unknown): unknown =>
    isSerializedDate(value) ? new Date(value.value) : isSerializedUndefined(value) ? undefined : value

const serializeScenarioValue = (value: unknown): ScenarioSerializedValue =>
    JSON.stringify(value, scenarioJsonReplacer) as ScenarioSerializedValue

const parseScenarioValue = <T>(value: ScenarioSerializedValue): T =>
    JSON.parse(value, scenarioJsonReviver) as T

const defaultScenario = (): RendererScenario => ({
    handlers: {
        'window-minimize': { kind: 'resolve' },
        'window-toggle-maximize': { kind: 'resolve', value: false },
        'window-close': { kind: 'resolve' },
        'get-app-version': { kind: 'resolve', value: '0.0.0-scenario' },
        'open-url': { kind: 'resolve' },
        'get-settings': { kind: 'resolve', value: { emailPluginConfig: {} } satisfies AppSettings },
        'set-settings': { kind: 'resolve' },
        'trigger-email-import': { kind: 'resolve' },
        'load-feed': { kind: 'resolve', value: [] },
        'has-feed': { kind: 'resolve', value: false },
        'mark-feed-item-viewed': { kind: 'resolve' },
        'metadata:ping': { kind: 'resolve', value: { ok: true } },
        'metadata:read': { kind: 'resolve', value: null },
        'metadata:write': { kind: 'resolve' },
        'metadata:scan': { kind: 'resolve' },
    },
})

const mergeScenario = (base: RendererScenario, override: Partial<RendererScenario>): RendererScenario => ({
    handlers: {
        ...base.handlers,
        ...override.handlers,
    },
})

export const scenarioBuilder = (scenario: Partial<RendererScenario> = {}) => {
    const current = mergeScenario(defaultScenario(), scenario)
    const setHasFeed = (options: { hasFeed?: boolean }, defaultValue: boolean) => {
        current.handlers['has-feed'] = { kind: 'resolve', value: options.hasFeed ?? defaultValue }
    }

    return {
        handler(channel: MainIpcChannel, behavior: ScenarioBehavior) {
            current.handlers[channel] = behavior
            return this
        },
        settings(settings: AppSettings) {
            current.handlers['get-settings'] = { kind: 'resolve', value: settings }
            return this
        },
        feed(items: HydratedFeedItem[], options: { hasFeed?: boolean } = {}) {
            current.handlers['load-feed'] = { kind: 'resolve', value: items }
            setHasFeed(options, items.length > 0)
            return this
        },
        feedLoadPending(options: { hasFeed?: boolean } = {}) {
            current.handlers['load-feed'] = { kind: 'pending' }
            setHasFeed(options, false)
            return this
        },
        feedLoadError(error: FeedLoadError, options: { hasFeed?: boolean } = {}) {
            current.handlers['load-feed'] = { kind: 'resolve', value: error }
            setHasFeed(options, false)
            return this
        },
        feedLoadSequence(steps: ScenarioBehavior[], options: { hasFeed?: boolean } = {}) {
            current.handlers['load-feed'] = { kind: 'sequence', steps }
            setHasFeed(options, false)
            return this
        },
        build(): RendererScenario {
            return {
                handlers: { ...current.handlers },
            }
        },
    }
}

export const createHydratedRelease = (overrides: Partial<HydratedFeedItem> = {}): HydratedFeedItem => ({
    id: 'release-1',
    type: 'BANDCAMP.TRALBUM',
    error: null,
    data: {
        releaseUrl: 'https://example.bandcamp.com/album/first-light',
        releaseDate: null,
        emailReceivedAt: new Date('2026-06-20T10:00:00.000Z'),
        isEmailRead: false,
        emailId: 'email-1',
        releaseName: 'Gecko',
        band: {
            name: 'Shiva Chandra',
            imageUrl: null,
            location: 'Berlin, Germany',
            bio: 'Quiet electronics and patient melodies.',
            links: [{ url: 'https://example.bandcamp.com', text: 'Bandcamp' }],
        },
        artist: 'Shiva Chandra',
        releaseType: 'album',
        about: 'A small release fixture for renderer scenario tests.',
        links: [],
        unsubscribeUrl: null,
        unsubscribeText: '',
        imageUrl:
            'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" width="300" height="300"%3E%3Crect width="300" height="300" fill="%23232f3e"/%3E%3C/svg%3E',
        iframeUrl: null,
        tracks: [
            {
                title: 'Karasu',
                id: 1,
                artist: 'Shiva Chandra',
                duration: 184,
                titleLink: null,
                albumPreorder: false,
                streamUrl:
                    'https://github.com/floydnant/release-maestro/raw/refs/heads/main/fixtures/06-karasu-ktmp3.mp3',
            },
        ],
    },
    ...overrides,
})

export const rendererScenarios = {
    feed: {
        emptyNoSetup: () => scenarioBuilder().feed([], { hasFeed: false }).build(),
        emptyCaughtUp: () => scenarioBuilder().feed([], { hasFeed: true }).build(),
        loadError: () =>
            scenarioBuilder()
                .feedLoadError({
                    isError: true,
                    name: 'FeedLoadError',
                    message: 'Backend failed to load the release feed',
                    userFacingMessage: 'Could not load releases',
                })
                .build(),
        withOneRelease: () => scenarioBuilder().feed([createHydratedRelease()]).build(),
    },
}

export class RendererScenarioController {
    constructor(private readonly page: Page) {}

    async calls(channel?: string): Promise<IpcCall[]> {
        const serializedCalls = await this.page.evaluate(
            selectedChannel =>
                window.__maestroScenario.serialize(window.__maestroScenario.calls(selectedChannel)),
            channel,
        )
        return parseScenarioValue(serializedCalls)
    }

    async lastCall(channel: string): Promise<IpcCall | undefined> {
        const serializedCall = await this.page.evaluate(
            selectedChannel =>
                window.__maestroScenario.serialize(window.__maestroScenario.lastCall(selectedChannel)),
            channel,
        )
        return parseScenarioValue(serializedCall)
    }

    setHandler(channel: MainIpcChannel, behavior: ScenarioBehavior): Promise<void> {
        const serializedBehavior = serializeScenarioValue(behavior)
        return this.page.evaluate(
            ({ selectedChannel, nextBehavior }) => {
                const behavior = window.__maestroScenario.deserialize(nextBehavior) as ScenarioBehavior
                window.__maestroScenario.setHandler(selectedChannel, behavior)
            },
            { selectedChannel: channel, nextBehavior: serializedBehavior },
        )
    }

    updateState(handlers: Partial<Record<MainIpcChannel, ScenarioBehavior>>): Promise<void> {
        const serializedHandlers = serializeScenarioValue(handlers)
        return this.page.evaluate(nextHandlers => {
            const handlers = window.__maestroScenario.deserialize(nextHandlers) as Partial<
                Record<MainIpcChannel, ScenarioBehavior>
            >
            for (const [channel, behavior] of Object.entries(handlers)) {
                if (behavior) window.__maestroScenario.setHandler(channel, behavior)
            }
        }, serializedHandlers)
    }

    resolvePending(channel: MainIpcChannel, value?: IpcPayload): Promise<void> {
        const serializedValue = value == null ? value : serializeScenarioValue(value)
        return this.page.evaluate(
            ({ selectedChannel, nextValue }) =>
                window.__maestroScenario.resolvePending(
                    selectedChannel,
                    nextValue == null ? nextValue : window.__maestroScenario.deserialize(nextValue),
                ),
            { selectedChannel: channel, nextValue: serializedValue },
        )
    }

    emit(channel: RendererIpcChannel, payload?: IpcPayload): Promise<void> {
        const serializedPayload = payload == null ? payload : serializeScenarioValue(payload)
        return this.page.evaluate(
            ({ selectedChannel, nextPayload }) =>
                window.__maestroScenario.emit(
                    selectedChannel,
                    nextPayload == null ? nextPayload : window.__maestroScenario.deserialize(nextPayload),
                ),
            { selectedChannel: channel, nextPayload: serializedPayload },
        )
    }
}

export const createRendererScenario = async (
    page: Page,
    scenario: RendererScenario,
    path = '/feed',
): Promise<RendererScenarioController> => {
    await page.addInitScript(
        serialization => {
            type Listener = (event: unknown, payload?: unknown) => void

            const isRecord = (value: unknown): value is Record<string, unknown> =>
                typeof value == 'object' && value != null

            const originalJsonValue = (holder: unknown, key: string, value: unknown): unknown => {
                if (!isRecord(holder)) return value
                return Object.prototype.hasOwnProperty.call(holder, key) ? holder[key] : value
            }

            const scenarioJsonReplacer = function (this: unknown, key: string, value: unknown): unknown {
                const originalValue = originalJsonValue(this, key, value)

                if (originalValue instanceof Date) {
                    return {
                        [serialization.serializedTypeKey]: serialization.dateType,
                        value: originalValue.toISOString(),
                    }
                }
                if (typeof value == 'undefined') {
                    return { [serialization.serializedTypeKey]: serialization.undefinedType }
                }
                return value
            }

            const serializeScenarioValue = (value: unknown) => JSON.stringify(value, scenarioJsonReplacer)
            const isSerializedDate = (value: unknown): value is { value: string } =>
                isRecord(value) &&
                value[serialization.serializedTypeKey] === serialization.dateType &&
                typeof value['value'] == 'string'
            const isSerializedUndefined = (value: unknown) =>
                isRecord(value) && value[serialization.serializedTypeKey] === serialization.undefinedType
            const scenarioJsonReviver = (_key: string, value: unknown) =>
                isSerializedDate(value)
                    ? new Date(value.value)
                    : isSerializedUndefined(value)
                      ? undefined
                      : value
            const parseScenarioValue = (value: ScenarioSerializedValue) =>
                JSON.parse(value, scenarioJsonReviver)

            const hydratedScenario = parseScenarioValue(serialization.scenario) as RendererScenario
            const state: ScenarioState = {
                handlers: hydratedScenario.handlers,
                calls: [],
                nextCallId: 1,
                pending: {},
            }
            const listeners = new Map<string, Set<Listener>>()

            const nextBehavior = (channel: string): ScenarioBehavior => {
                const behavior = state.handlers[channel]
                if (!behavior)
                    return { kind: 'reject', message: `No scenario handler configured for ${channel}` }

                if (behavior.kind !== 'sequence') return behavior

                const nextStep = behavior.steps.shift()
                if (nextStep) return nextStep
                return (
                    behavior.fallback ?? {
                        kind: 'reject',
                        message: `No scenario sequence step left for ${channel}`,
                    }
                )
            }

            const settlePending = (
                channel: string,
                settle: (pendingCall: ScenarioState['pending'][string][number]) => void,
            ) => {
                const pending = state.pending[channel]?.shift()
                if (!pending) throw new Error(`No pending scenario call for ${channel}`)
                settle(pending)
            }

            const ipcRenderer = {
                invoke(channel: string, payload?: unknown) {
                    const call = { id: state.nextCallId++, channel, payload }
                    state.calls.push(call)

                    const behavior = nextBehavior(channel)
                    if (behavior.kind === 'resolve') {
                        return Promise.resolve(behavior.value)
                    }
                    if (behavior.kind === 'reject') {
                        const error = new Error(behavior.message)
                        if (behavior.userFacingMessage) {
                            Object.assign(error, { userFacingMessage: behavior.userFacingMessage })
                        }
                        return Promise.reject(error)
                    }

                    return new Promise(resolve => {
                        const pendingCall = { callId: call.id, channel, resolve }
                        state.pending[channel] = [...(state.pending[channel] ?? []), pendingCall]
                    })
                },
                send(channel: string, payload?: unknown) {
                    state.calls.push({ id: state.nextCallId++, channel, payload })
                },
                on(channel: string, listener: Listener) {
                    listeners.set(channel, listeners.get(channel) ?? new Set())
                    listeners.get(channel)?.add(listener)
                    return ipcRenderer
                },
                off(channel: string, listener: Listener) {
                    listeners.get(channel)?.delete(listener)
                    return ipcRenderer
                },
                once(channel: string, listener: Listener) {
                    const onceListener: Listener = (event, payload) => {
                        ipcRenderer.off(channel, onceListener)
                        listener(event, payload)
                    }
                    return ipcRenderer.on(channel, onceListener)
                },
            }

            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            ;(window as any).process = { type: 'renderer', platform: 'darwin' }
            const originalRequire = window.require
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            ;(window as any).require = (moduleName: string) => {
                if (moduleName === 'electron') return { ipcRenderer }
                if (originalRequire) return originalRequire(moduleName)
                throw new Error(`Renderer scenario did not mock window.require("${moduleName}")`)
            }
            window.__maestroScenario = {
                calls: channel => state.calls.filter(call => !channel || call.channel === channel),
                lastCall: channel => state.calls.filter(call => call.channel === channel).at(-1),
                setHandler: (channel, behavior) => {
                    state.handlers[channel] = behavior
                },
                resolvePending: (channel, value) => {
                    settlePending(channel, pendingCall => pendingCall.resolve(value))
                },
                emit: (channel, payload) => {
                    for (const listener of listeners.get(channel) ?? []) {
                        listener({}, payload)
                    }
                },
                deserialize: parseScenarioValue,
                serialize: serializeScenarioValue,
            }
        },
        {
            dateType: SCENARIO_SERIALIZED_DATE_TYPE,
            scenario: serializeScenarioValue(scenario),
            serializedTypeKey: SCENARIO_SERIALIZED_TYPE_KEY,
            undefinedType: SCENARIO_SERIALIZED_UNDEFINED_TYPE,
        },
    )

    await page.goto(path, { waitUntil: 'domcontentloaded' })

    return new RendererScenarioController(page)
}
