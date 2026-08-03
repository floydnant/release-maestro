import { Page } from '@playwright/test'
import {
    AppSettings,
    FeedLoadError,
    HydratedFeedItem,
    MainIpcContract,
    RendererIpcContract,
    SongFilterDescription,
    SongRow,
    SongWindowResult,
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
    | { kind: 'set-settings' }
    | { kind: 'patch-settings' }
    | { kind: 'reject'; message: string; userFacingMessage?: string }
    | { kind: 'pending' }
    | { kind: 'sequence'; steps: ScenarioBehavior[]; fallback?: ScenarioBehavior }
    /**
     * Answer from a {@link ScenarioPreset} — a canned responder that reads the request.
     *
     * Everything above says *how a call settles*; this says *what the answer contains*,
     * and the two are deliberately separate. Presets exist because a static value
     * cannot answer a request that varies: a windowed list asks for a different slice
     * on every scroll, and asserting against a fixture that ignores the offset proves
     * only that the table asked correctly, never that it rendered what came back.
     *
     * They are named rather than passed as functions because the harness is installed
     * inside the page: a callback would have to cross the Playwright boundary on every
     * IPC call. The preset table lives in there with it.
     */
    | { kind: 'preset'; preset: ScenarioPreset; options?: IpcPayload }

/**
 * Canned responders that compute an answer from the request.
 *
 * `song-window` serves the window `library:query-songs` asked for out of a catalog of
 * `total` rows, titling each `Row <absolute index>` so a test can name the rows it
 * expects at a scroll position.
 */
export type ScenarioPreset = 'song-window'

export type RendererScenario = {
    handlers: Record<string, ScenarioBehavior>
}

type ScenarioState = {
    handlers: Record<string, ScenarioBehavior>
    settings: AppSettings
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
            resolveAllPending: (channel: string, value?: IpcPayload) => void
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

const EMPTY_FILTER_DESCRIPTION: SongFilterDescription = {
    artists: [],
    genres: [],
    recordLabels: [],
    albums: [],
}

const defaultScenario = (): RendererScenario => ({
    handlers: {
        'window-minimize': { kind: 'resolve' },
        'window-toggle-maximize': { kind: 'resolve', value: false },
        'window-close': { kind: 'resolve' },
        'get-app-version': { kind: 'resolve', value: '0.0.0-scenario' },
        'open-url': { kind: 'resolve' },
        // A configured library keeps the onboarding route guard from redirecting
        // scenario navigations to /import.
        'get-settings': {
            kind: 'resolve',
            value: {
                library: { folders: ['/scenario/music'] },
                emailPluginConfig: {},
            } satisfies AppSettings,
        },
        'set-settings': { kind: 'set-settings' },
        'patch-settings': { kind: 'patch-settings' },
        'trigger-email-import': { kind: 'resolve' },
        'load-feed': { kind: 'resolve', value: [] },
        'has-feed': { kind: 'resolve', value: false },
        'mark-feed-item-viewed': { kind: 'resolve' },
        'metadata:ping': { kind: 'resolve', value: { ok: true } },
        'metadata:read': { kind: 'resolve', value: null },
        'metadata:write': { kind: 'resolve' },
        'library:get-scan-status': {
            kind: 'resolve',
            value: { status: null, albums: [], lastScan: null },
        },
        'library:validate-folders': { kind: 'resolve', value: [] },
        'library:pick-folders': { kind: 'resolve', value: null },
        'library:query-songs': {
            kind: 'resolve',
            value: { rows: [], offset: 0, total: 0 } satisfies SongWindowResult,
        },
        'library:describe-song-filter': {
            kind: 'resolve',
            value: EMPTY_FILTER_DESCRIPTION,
        },
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
        /**
         * One window of tracks.
         *
         * The harness answers with a fixed value rather than reacting to the requested
         * window, so `total` is stated separately: that is what lets a test set up a
         * library far larger than the rows it hands over, and assert that scrolling
         * asks for a *different* window rather than that the fake paged correctly.
         */
        songs(rows: SongRow[], options: { total?: number; offset?: number } = {}) {
            current.handlers['library:query-songs'] = {
                kind: 'resolve',
                value: {
                    rows,
                    offset: options.offset ?? 0,
                    total: options.total ?? rows.length,
                } satisfies SongWindowResult,
            }
            return this
        },
        /**
         * Serve whatever window is asked for, out of a catalog of `total` rows titled
         * `Row 0`, `Row 1`, … Use this when the assertion is about what the table
         * *renders*; `songs()` serves one fixed window and is right when the assertion
         * is about what it *requests*.
         */
        songCatalog(total: number) {
            current.handlers['library:query-songs'] = {
                kind: 'preset',
                preset: 'song-window',
                options: { total },
            }
            return this
        },
        songFilterDescription(description: Partial<SongFilterDescription>) {
            current.handlers['library:describe-song-filter'] = {
                kind: 'resolve',
                value: { ...EMPTY_FILTER_DESCRIPTION, ...description },
            }
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
        releaseUrl: 'https://example.bandcamp.com/album/gecko',
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
                    'https://github.com/floydnant/release-maestro/raw/db7766d68cbb1d8053c1ca471195e6f10c3c2d32/fixtures/06-karasu-ktmp3.mp3',
            },
        ],
    },
    ...overrides,
})

/**
 * One track row, credited to a single artist entity — which is what ingest actually
 * produces today, because it never splits a raw name (MAE-97 owns that). Pass a
 * multi-name `artistText` to get the `Burial & Four Tet` case: still one segment.
 */
export const createSongRow = (overrides: Partial<SongRow> = {}): SongRow => {
    const artistText = overrides.artistText === undefined ? 'Aurora Fields' : overrides.artistText
    return {
        id: 'song-1',
        path: '/scenario/music/dawn.mp3',
        present: true,
        title: 'Dawn',
        // No cover path by default: a `file://` src would 404 in a browser scenario,
        // and the fallback placeholder is what most rows render anyway.
        coverPath: null,
        artistText,
        artistCredit: artistText ? [{ artistId: 'artist-1', creditedAs: artistText, joinPhrase: '' }] : [],
        albumId: 'album-1',
        albumTitle: 'Daybreak',
        genreText: 'Ambient',
        genres: [{ id: 'genre-1', name: 'Ambient' }],
        recordLabelId: 'label-1',
        recordLabelText: 'Kosmische',
        year: 2019,
        bpm: 120,
        musicalKey: '8A',
        duration: 245,
        dateAdded: Date.UTC(2026, 0, 15),
        ...overrides,
    }
}

/** A handful of rows that disagree on every sortable column. */
export const createSongRows = (): SongRow[] => [
    createSongRow(),
    createSongRow({
        id: 'song-2',
        path: '/scenario/music/dusk.mp3',
        title: 'Dusk',
        artistText: 'Night Cartel',
        artistCredit: [{ artistId: 'artist-2', creditedAs: 'Night Cartel', joinPhrase: '' }],
        albumId: 'album-2',
        albumTitle: 'Afterglow',
        genreText: 'Techno',
        genres: [{ id: 'genre-2', name: 'Techno' }],
        recordLabelId: 'label-2',
        recordLabelText: 'Hardwire',
        year: 2021,
        bpm: 140,
        musicalKey: '4A',
        duration: 372,
        dateAdded: Date.UTC(2026, 1, 3),
    }),
    createSongRow({
        id: 'song-3',
        path: '/scenario/music/void.mp3',
        title: 'Void',
        // Two names, one artist entity — the degenerate credit the table must print
        // verbatim while still addressing an entity.
        artistText: 'Night Cartel & Aurora Fields',
        artistCredit: [{ artistId: 'artist-3', creditedAs: 'Night Cartel & Aurora Fields', joinPhrase: '' }],
        albumId: 'album-2',
        albumTitle: 'Afterglow',
        genreText: 'Techno',
        genres: [{ id: 'genre-2', name: 'Techno' }],
        recordLabelId: 'label-2',
        recordLabelText: 'Hardwire',
        year: 2021,
        bpm: 134,
        musicalKey: '11B',
        duration: 198,
        dateAdded: Date.UTC(2026, 2, 20),
        present: false,
    }),
]

export const rendererScenarios = {
    tracks: {
        empty: () => scenarioBuilder().songs([]).build(),
        withSongs: () => scenarioBuilder().songs(createSongRows()).build(),
        loadPending: () => scenarioBuilder().handler('library:query-songs', { kind: 'pending' }).build(),
        loadError: () =>
            scenarioBuilder()
                .handler('library:query-songs', {
                    kind: 'reject',
                    message: 'Backend failed to query the library',
                    userFacingMessage: 'Could not reach the library',
                })
                .build(),
    },
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

    /**
     * Resolve every outstanding call on a channel with the same value.
     *
     * Needed where the renderer supersedes its own request — a browse view fetches a
     * guessed window, then a measured one, and `switchMap` abandons the first. With
     * one-at-a-time `resolvePending` the test would settle the abandoned call and
     * wait forever for a render that never comes.
     */
    resolveAllPending(channel: MainIpcChannel, value?: IpcPayload): Promise<void> {
        const serializedValue = value == null ? value : serializeScenarioValue(value)
        return this.page.evaluate(
            ({ selectedChannel, nextValue }) =>
                window.__maestroScenario.resolveAllPending(
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
            const getSettingsBehavior = hydratedScenario.handlers['get-settings']
            if (getSettingsBehavior?.kind !== 'resolve') {
                throw new Error('Renderer scenarios require a resolving get-settings handler')
            }
            const state: ScenarioState = {
                handlers: hydratedScenario.handlers,
                settings: getSettingsBehavior.value as AppSettings,
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
                    if (behavior.kind === 'set-settings') {
                        state.settings = payload as AppSettings
                        return Promise.resolve(state.settings)
                    }
                    if (behavior.kind === 'patch-settings') {
                        state.settings = { ...state.settings, ...(payload as Partial<AppSettings>) }
                        return Promise.resolve(state.settings)
                    }
                    if (behavior.kind === 'reject') {
                        const error = new Error(behavior.message)
                        if (behavior.userFacingMessage) {
                            Object.assign(error, { userFacingMessage: behavior.userFacingMessage })
                        }
                        return Promise.reject(error)
                    }
                    if (behavior.kind === 'preset') {
                        // One preset today; the switch is where a second one lands.
                        const total = (behavior.options as { total?: number } | undefined)?.total ?? 0
                        const requested = (payload as { window?: { offset?: number; limit?: number } })
                            ?.window
                        const offset = Math.max(0, Math.min(requested?.offset ?? 0, total))
                        const limit = Math.max(0, requested?.limit ?? 0)
                        const count = Math.max(0, Math.min(limit, total - offset))
                        return Promise.resolve({
                            rows: Array.from({ length: count }, (_row, position) => {
                                const index = offset + position
                                return {
                                    id: `song-${index}`,
                                    path: `/scenario/music/row-${index}.mp3`,
                                    present: true,
                                    title: `Row ${index}`,
                                    coverPath: null,
                                    artistText: null,
                                    artistCredit: [],
                                    albumId: null,
                                    albumTitle: null,
                                    genreText: null,
                                    genres: [],
                                    recordLabelId: null,
                                    recordLabelText: null,
                                    year: null,
                                    bpm: null,
                                    musicalKey: null,
                                    duration: null,
                                    dateAdded: null,
                                }
                            }),
                            offset,
                            total,
                        })
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
                resolveAllPending: (channel, value) => {
                    const pending = state.pending[channel] ?? []
                    if (pending.length === 0) throw new Error(`No pending scenario call for ${channel}`)
                    state.pending[channel] = []
                    for (const pendingCall of pending) pendingCall.resolve(value)
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
