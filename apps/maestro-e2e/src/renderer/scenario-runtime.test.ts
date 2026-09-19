import { describe, expect, it } from '@jest/globals'
import type { ScenarioBehavior } from './scenario-harness'
import { createScenarioRuntime } from './scenario-runtime'

const { serializeScenarioValue, parseScenarioValue, nextBehavior } = createScenarioRuntime()

describe('scenario serialization', () => {
    const capturedAt = new Date('2026-07-01T12:34:56.000Z')
    const dateTag = { __maestroScenarioSerializedType: 'Date', value: capturedAt.toISOString() }
    const undefinedTag = { __maestroScenarioSerializedType: 'Undefined' }

    it.each([
        { name: 'a root date', value: capturedAt, encoded: dateTag },
        { name: 'root undefined', value: undefined, encoded: undefinedTag },
        {
            name: 'nested dates and undefined properties',
            value: { nested: { capturedAt, missing: undefined } },
            encoded: { nested: { capturedAt: dateTag, missing: undefinedTag } },
        },
        {
            name: 'dates and undefined in arrays',
            value: [capturedAt, undefined, { nested: [undefined, capturedAt] }],
            encoded: [dateTag, undefinedTag, { nested: [undefinedTag, dateTag] }],
        },
        {
            name: 'ordinary JSON values',
            value: { text: '2026-07-01T12:34:56.000Z', empty: null, count: 0, enabled: false },
            encoded: { text: '2026-07-01T12:34:56.000Z', empty: null, count: 0, enabled: false },
        },
    ])('encodes and decodes $name', ({ value, encoded }) => {
        expect(JSON.parse(serializeScenarioValue(value))).toStrictEqual(encoded)
        expect(parseScenarioValue(JSON.stringify(encoded))).toStrictEqual(value)
        expect(parseScenarioValue(serializeScenarioValue(value))).toStrictEqual(value)
    })

    it('preserves holes separately from explicit undefined array elements', () => {
        const sparse: unknown[] = new Array(5)
        sparse[1] = undefined
        sparse[3] = capturedAt
        const value = { sparse, empty: new Array(2), nested: [sparse] }

        expect(parseScenarioValue(serializeScenarioValue(value))).toStrictEqual(value)
    })

    it('preserves records that collide with reserved serialization tags', () => {
        const value = [
            { __maestroScenarioSerializedType: 'ArrayHole' },
            { __maestroScenarioSerializedType: 'Undefined' },
            { __maestroScenarioSerializedType: 'Date', value: capturedAt.toISOString() },
        ]

        expect(parseScenarioValue(serializeScenarioValue(value))).toStrictEqual(value)
    })

    it('leaves unrecognized tags and date tags without a string value alone', () => {
        const value = [
            { __maestroScenarioSerializedType: 'Future', value: 'unchanged' },
            { __maestroScenarioSerializedType: 'Date', value: 42 },
        ]
        expect(parseScenarioValue(serializeScenarioValue(value))).toStrictEqual(value)
    })

    it('rejects a date tag whose string is not a valid date', () => {
        const value = JSON.stringify({
            __maestroScenarioSerializedType: 'Date',
            value: 'not-a-date',
        })
        expect(() => parseScenarioValue(value)).toThrow('Invalid serialized scenario date')
    })
})

describe('scenario behavior selection', () => {
    it('consumes one step per call and repeatedly uses the fallback after exhaustion', () => {
        const first: ScenarioBehavior = { kind: 'pending' }
        const second: ScenarioBehavior = { kind: 'reject', message: 'Try again' }
        const fallback: ScenarioBehavior = { kind: 'resolve', value: 'recovered' }
        const handlers = {
            retry: { kind: 'sequence', steps: [first, second], fallback },
        } satisfies Record<string, ScenarioBehavior>

        expect(nextBehavior(handlers, 'retry')).toBe(first)
        expect(handlers.retry.steps).toEqual([second])
        expect(nextBehavior(handlers, 'retry')).toBe(second)
        expect(nextBehavior(handlers, 'retry')).toBe(fallback)
        expect(nextBehavior(handlers, 'retry')).toBe(fallback)
    })

    it('rejects exhausted sequences without a fallback', () => {
        const handlers = {
            once: { kind: 'sequence', steps: [{ kind: 'resolve', value: 1 }] },
        } satisfies Record<string, ScenarioBehavior>

        expect(nextBehavior(handlers, 'once')).toEqual({ kind: 'resolve', value: 1 })
        expect(nextBehavior(handlers, 'once')).toEqual({
            kind: 'reject',
            message: 'No scenario sequence step left for once',
        })
    })

    it('uses a fallback immediately for an empty sequence', () => {
        const fallback: ScenarioBehavior = { kind: 'resolve' }
        expect(nextBehavior({ empty: { kind: 'sequence', steps: [], fallback } }, 'empty')).toBe(fallback)
    })

    it('keeps separate channel sequences independent', () => {
        const handlers = {
            first: { kind: 'sequence', steps: [{ kind: 'resolve', value: 1 }] },
            second: { kind: 'sequence', steps: [{ kind: 'resolve', value: 2 }] },
        } satisfies Record<string, ScenarioBehavior>

        nextBehavior(handlers, 'first')
        expect(nextBehavior(handlers, 'second')).toEqual({ kind: 'resolve', value: 2 })
    })

    it('returns a non-sequence handler without consuming it', () => {
        const behavior: ScenarioBehavior = { kind: 'respond', responder: 'catalog' }
        expect(nextBehavior({ catalog: behavior }, 'catalog')).toBe(behavior)
        expect(nextBehavior({ catalog: behavior }, 'catalog')).toBe(behavior)
    })

    it('rejects channels without a configured handler', () => {
        expect(nextBehavior({}, 'missing')).toEqual({
            kind: 'reject',
            message: 'No scenario handler configured for missing',
        })
    })
})

describe('scenario boundary validation', () => {
    const { isScenarioBehavior, isRendererScenario, isIpcCall, isIpcCalls } = createScenarioRuntime()

    it.each([
        null,
        { kind: 'unknown' },
        { kind: 'reject', message: 42 },
        { kind: 'reject', message: 'failed', userFacingMessage: 42 },
        { kind: 'respond', responder: false },
        { kind: 'sequence', steps: [{ kind: 'reject' }] },
        { kind: 'sequence', steps: [], fallback: { kind: 'unknown' } },
        { kind: 'sequence', steps: new Array(1) },
    ])('rejects invalid behavior %j after decoding', value => {
        expect(isScenarioBehavior(parseScenarioValue(serializeScenarioValue(value)))).toBe(false)
    })

    it('validates nested behaviors in a decoded scenario', () => {
        const scenario = {
            handlers: {
                retry: {
                    kind: 'sequence',
                    steps: [{ kind: 'pending' }, { kind: 'reject', message: 'retry' }],
                    fallback: { kind: 'resolve', value: undefined },
                },
                responder: { kind: 'respond', responder: 'catalog' },
                settings: { kind: 'set-settings' },
                patch: { kind: 'patch-settings' },
            },
        }
        expect(isRendererScenario(parseScenarioValue(serializeScenarioValue(scenario)))).toBe(true)
        expect(isRendererScenario({ handlers: { broken: { kind: 'reject' } } })).toBe(false)
        expect(isRendererScenario({ handlers: [] })).toBe(false)
    })

    it('validates recorded calls without restricting their payload', () => {
        const call = { id: 1, channel: 'metadata:read', payload: undefined }
        expect(isIpcCall(parseScenarioValue(serializeScenarioValue(call)))).toBe(true)
        expect(isIpcCalls(parseScenarioValue(serializeScenarioValue([call])))).toBe(true)
        expect(isIpcCalls([{ id: '1', channel: 'metadata:read' }])).toBe(false)
        expect(isIpcCalls([{ id: 1, channel: null }])).toBe(false)
        expect(isIpcCalls({})).toBe(false)
        expect(isIpcCall({ id: 1, channel: 'metadata:read' })).toBe(false)
        expect(isIpcCalls(new Array(1))).toBe(false)
    })
})
