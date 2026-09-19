import type { ScenarioBehavior } from './scenario-harness'

/** Kept self-contained so the same helpers can run in Node and a Playwright init script. */
export const createScenarioRuntime = () => {
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

    // A JSON.parse reviver returning undefined deletes the property or array slot.
    // Walk the parsed value instead so explicit undefined values survive intact.
    const reviveScenarioValue = (value: unknown): unknown => {
        if (isSerializedDate(value)) return new Date(value.value)
        if (isSerializedUndefined(value)) return undefined
        if (Array.isArray(value)) return value.map(reviveScenarioValue)
        if (isRecord(value)) {
            return Object.fromEntries(
                Object.entries(value).map(([key, entry]) => [key, reviveScenarioValue(entry)]),
            )
        }
        return value
    }

    const serializeScenarioValue = (value: unknown): string => JSON.stringify(value, scenarioJsonReplacer)

    const parseScenarioValue = <T>(value: string): T => reviveScenarioValue(JSON.parse(value)) as T

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

    return { serializeScenarioValue, parseScenarioValue, nextBehavior }
}
