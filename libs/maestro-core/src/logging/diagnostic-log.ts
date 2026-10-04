/** Fields in diagnostic logs are deliberately scalar. Do not pass settings or domain objects. */
export type DiagnosticFields = Record<string, string | number | boolean | null>
export type DiagnosticLevel = 'debug' | 'info' | 'warn' | 'error'

export interface DiagnosticEntry {
    level: DiagnosticLevel
    scope: string
    event: string
    fields: DiagnosticFields
}

const MAX_FIELDS = 20
const MAX_FIELD_LENGTH = 2_000
const MAX_STACK_LENGTH = 4_000

/** Keep useful error text while removing common private data before it reaches any sink. */
export function sanitizeDiagnosticText(value: string, maxLength = MAX_FIELD_LENGTH): string {
    return value
        .replace(/https?:\/\/[^\s)]+/gi, '[url]')
        .replace(/[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}/g, '[email]')
        .replace(/(?:[A-Za-z]:\\|\/)[^)\r\n'"<>]*/g, '[path]')
        .slice(0, maxLength)
}

export function diagnosticErrorFields(error: unknown): DiagnosticFields {
    if (!(error instanceof Error)) return { errorName: 'Unknown', errorMessage: 'Unknown error' }

    const fields: DiagnosticFields = {
        errorName: sanitizeDiagnosticText(error.name),
        errorMessage: sanitizeDiagnosticText(error.message),
    }
    if ('code' in error && typeof error.code === 'string') {
        fields['errorCode'] = sanitizeDiagnosticText(error.code)
    }
    if (error.stack) {
        fields['errorStack'] = sanitizeDiagnosticText(error.stack, MAX_STACK_LENGTH)
    }
    return fields
}

export function diagnosticEntry(
    level: DiagnosticLevel,
    scope: string,
    event: string,
    fields: DiagnosticFields = {},
    error?: unknown,
): DiagnosticEntry {
    const safeFields: DiagnosticFields = {}
    for (const [key, value] of Object.entries({
        ...(error === undefined ? {} : diagnosticErrorFields(error)),
        ...fields,
    }).slice(0, MAX_FIELDS)) {
        if (!/^[a-zA-Z][a-zA-Z0-9]*$/.test(key)) continue
        if (typeof value === 'string') {
            safeFields[key] = sanitizeDiagnosticText(
                value,
                key === 'errorStack' ? MAX_STACK_LENGTH : MAX_FIELD_LENGTH,
            )
        } else if (
            typeof value === 'boolean' ||
            value === null ||
            (typeof value === 'number' && Number.isFinite(value))
        ) {
            safeFields[key] = value
        }
    }
    return {
        level,
        scope: sanitizeDiagnosticText(scope).slice(0, 80),
        event: sanitizeDiagnosticText(event).slice(0, 100),
        fields: safeFields,
    }
}

/** Treat renderer IPC as untrusted input, even though the renderer has a typed caller. */
export function parseDiagnosticEntry(value: unknown): DiagnosticEntry | null {
    if (!value || typeof value !== 'object') return null
    const entry = value as Partial<DiagnosticEntry>
    if (!['debug', 'info', 'warn', 'error'].includes(entry.level ?? '')) return null
    if (typeof entry.scope !== 'string' || typeof entry.event !== 'string') return null
    if (!entry.fields || typeof entry.fields !== 'object' || Array.isArray(entry.fields)) return null
    if (Object.keys(entry.fields).length > MAX_FIELDS) return null
    for (const field of Object.values(entry.fields)) {
        if (field !== null && !['string', 'number', 'boolean'].includes(typeof field)) return null
    }
    return diagnosticEntry(entry.level as DiagnosticLevel, entry.scope, entry.event, entry.fields)
}
