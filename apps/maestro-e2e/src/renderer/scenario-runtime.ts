import type { IpcCall, RendererScenario, ScenarioBehavior } from './scenario-harness'

/** Kept self-contained so the same helpers can run in Node and a Playwright init script. */
export const createScenarioRuntime = () => {
    const SCENARIO_SERIALIZED_TYPE_KEY = '__maestroScenarioSerializedType'
    const SCENARIO_SERIALIZED_DATE_TYPE = 'Date'
    const SCENARIO_SERIALIZED_UNDEFINED_TYPE = 'Undefined'
    const SCENARIO_SERIALIZED_HOLE_TYPE = 'ArrayHole'
    const SCENARIO_SERIALIZED_ESCAPED_RECORD_TYPE = 'EscapedRecord'

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
        if (Array.isArray(this) && !Object.prototype.hasOwnProperty.call(this, key)) {
            return { [SCENARIO_SERIALIZED_TYPE_KEY]: SCENARIO_SERIALIZED_HOLE_TYPE }
        }
        if (typeof value == 'undefined') {
            return { [SCENARIO_SERIALIZED_TYPE_KEY]: SCENARIO_SERIALIZED_UNDEFINED_TYPE }
        }
        if (isRecord(value) && Object.prototype.hasOwnProperty.call(value, SCENARIO_SERIALIZED_TYPE_KEY)) {
            return {
                [SCENARIO_SERIALIZED_TYPE_KEY]: SCENARIO_SERIALIZED_ESCAPED_RECORD_TYPE,
                entries: Object.entries(value),
            }
        }
        return value
    }

    const isSerializedDate = (value: unknown): value is { value: string } =>
        isRecord(value) &&
        value[SCENARIO_SERIALIZED_TYPE_KEY] === SCENARIO_SERIALIZED_DATE_TYPE &&
        typeof value['value'] == 'string'
    const isSerializedUndefined = (value: unknown): boolean =>
        isRecord(value) && value[SCENARIO_SERIALIZED_TYPE_KEY] === SCENARIO_SERIALIZED_UNDEFINED_TYPE
    const isSerializedEscapedRecord = (value: unknown): value is { entries: [string, unknown][] } =>
        isRecord(value) &&
        value[SCENARIO_SERIALIZED_TYPE_KEY] === SCENARIO_SERIALIZED_ESCAPED_RECORD_TYPE &&
        Array.isArray(value['entries']) &&
        Array.from(value['entries']).every(
            entry => Array.isArray(entry) && entry.length === 2 && typeof entry[0] === 'string',
        )

    // A JSON.parse reviver returning undefined deletes the property or array slot.
    // Walk the parsed value instead so explicit undefined values survive intact.
    const reviveScenarioValue = (value: unknown): unknown => {
        if (isSerializedDate(value)) {
            const date = new Date(value.value)
            if (Number.isNaN(date.valueOf())) throw new Error('Invalid serialized scenario date')
            return date
        }
        if (isSerializedUndefined(value)) return undefined
        if (isSerializedEscapedRecord(value)) {
            return Object.fromEntries(value.entries.map(([key, entry]) => [key, reviveScenarioValue(entry)]))
        }
        if (Array.isArray(value)) {
            const revived: unknown[] = new Array(value.length)
            value.forEach((entry: unknown, index) => {
                if (
                    isRecord(entry) &&
                    entry[SCENARIO_SERIALIZED_TYPE_KEY] === SCENARIO_SERIALIZED_HOLE_TYPE
                ) {
                    return
                }
                revived[index] = reviveScenarioValue(entry)
            })
            return revived
        }
        if (isRecord(value)) {
            return Object.fromEntries(
                Object.entries(value).map(([key, entry]) => [key, reviveScenarioValue(entry)]),
            )
        }
        return value
    }

    const serializeScenarioValue = (value: unknown): string => JSON.stringify(value, scenarioJsonReplacer)

    const parseScenarioValue = (value: string): unknown => reviveScenarioValue(JSON.parse(value))

    const isScenarioBehavior = (value: unknown): value is ScenarioBehavior => {
        if (!isRecord(value) || Array.isArray(value)) return false
        switch (value['kind']) {
            case 'resolve':
            case 'set-settings':
            case 'patch-settings':
            case 'pending':
                return true
            case 'reject':
                return (
                    typeof value['message'] === 'string' &&
                    (value['userFacingMessage'] === undefined ||
                        typeof value['userFacingMessage'] === 'string')
                )
            case 'respond':
                return typeof value['responder'] === 'string'
            case 'sequence':
                return (
                    Array.isArray(value['steps']) &&
                    Array.from(value['steps']).every(isScenarioBehavior) &&
                    (value['fallback'] === undefined || isScenarioBehavior(value['fallback']))
                )
            default:
                return false
        }
    }

    const isScenarioHandlers = (value: unknown): value is Record<string, ScenarioBehavior> =>
        isRecord(value) && !Array.isArray(value) && Object.values(value).every(isScenarioBehavior)

    const isRendererScenario = (value: unknown): value is RendererScenario =>
        isRecord(value) && !Array.isArray(value) && isScenarioHandlers(value['handlers'])

    const isIpcCall = (value: unknown): value is IpcCall =>
        isRecord(value) &&
        !Array.isArray(value) &&
        typeof value['id'] === 'number' &&
        typeof value['channel'] === 'string' &&
        Object.prototype.hasOwnProperty.call(value, 'payload')

    const isIpcCalls = (value: unknown): value is IpcCall[] =>
        Array.isArray(value) && Array.from(value).every(isIpcCall)

    const nextBehavior = (handlers: Record<string, ScenarioBehavior>, channel: string): ScenarioBehavior => {
        const behavior = handlers[channel]
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

    return {
        serializeScenarioValue,
        parseScenarioValue,
        isScenarioBehavior,
        isRendererScenario,
        isIpcCall,
        isIpcCalls,
        nextBehavior,
    }
}
