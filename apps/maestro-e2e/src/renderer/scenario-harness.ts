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
        }
    }
}

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

    calls(channel?: string): Promise<IpcCall[]> {
        return this.page.evaluate(selectedChannel => window.__maestroScenario.calls(selectedChannel), channel)
    }

    lastCall(channel: string): Promise<IpcCall | undefined> {
        return this.page.evaluate(
            selectedChannel => window.__maestroScenario.lastCall(selectedChannel),
            channel,
        )
    }

    setHandler(channel: MainIpcChannel, behavior: ScenarioBehavior): Promise<void> {
        return this.page.evaluate(
            ({ selectedChannel, nextBehavior }) =>
                window.__maestroScenario.setHandler(selectedChannel, nextBehavior),
            { selectedChannel: channel, nextBehavior: behavior },
        )
    }

    updateState(handlers: Partial<Record<MainIpcChannel, ScenarioBehavior>>): Promise<void> {
        return this.page.evaluate(nextHandlers => {
            for (const [channel, behavior] of Object.entries(nextHandlers)) {
                if (behavior) window.__maestroScenario.setHandler(channel, behavior)
            }
        }, handlers)
    }

    resolvePending(channel: MainIpcChannel, value?: IpcPayload): Promise<void> {
        return this.page.evaluate(
            ({ selectedChannel, nextValue }) =>
                window.__maestroScenario.resolvePending(selectedChannel, nextValue),
            { selectedChannel: channel, nextValue: value },
        )
    }

    emit(channel: RendererIpcChannel, payload?: IpcPayload): Promise<void> {
        return this.page.evaluate(
            ({ selectedChannel, nextPayload }) => window.__maestroScenario.emit(selectedChannel, nextPayload),
            { selectedChannel: channel, nextPayload: payload },
        )
    }
}

export const createRendererScenario = async (
    page: Page,
    scenario: RendererScenario,
    path = '/feed',
): Promise<RendererScenarioController> => {
    await page.addInitScript(initialScenario => {
        type Listener = (event: unknown, payload?: unknown) => void

        const isRecord = (value: unknown): value is Record<string, unknown> =>
            typeof value == 'object' && value != null
        const reviveLoadFeedDates = (value: unknown) => {
            if (!Array.isArray(value)) return value

            return value.map(feedItem => {
                if (!isRecord(feedItem) || !isRecord(feedItem['data'])) return feedItem

                const data = feedItem['data']
                return {
                    ...feedItem,
                    data: {
                        ...data,
                        emailReceivedAt:
                            typeof data['emailReceivedAt'] == 'string'
                                ? new Date(data['emailReceivedAt'])
                                : data['emailReceivedAt'],
                        releaseDate:
                            typeof data['releaseDate'] == 'string'
                                ? new Date(data['releaseDate'])
                                : data['releaseDate'],
                    },
                }
            })
        }
        const reviveIpcPayload = (channel: string, payload: unknown) =>
            channel == 'load-feed' ? reviveLoadFeedDates(payload) : payload

        const hydratedScenario = initialScenario as RendererScenario
        const state: ScenarioState = {
            handlers: hydratedScenario.handlers,
            calls: [],
            nextCallId: 1,
            pending: {},
        }
        const listeners = new Map<string, Set<Listener>>()

        const nextBehavior = (channel: string): ScenarioBehavior => {
            const behavior = state.handlers[channel]
            if (!behavior) return { kind: 'reject', message: `No scenario handler configured for ${channel}` }

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
                    return Promise.resolve(reviveIpcPayload(channel, behavior.value))
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
                settlePending(channel, pendingCall => pendingCall.resolve(reviveIpcPayload(channel, value)))
            },
            emit: (channel, payload) => {
                for (const listener of listeners.get(channel) ?? []) {
                    listener({}, payload)
                }
            },
        }
    }, scenario)

    await page.goto(path, { waitUntil: 'domcontentloaded' })

    return new RendererScenarioController(page)
}
