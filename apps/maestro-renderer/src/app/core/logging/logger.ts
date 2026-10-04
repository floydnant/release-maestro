import { AppIpcRenderer, DiagnosticEntry, DiagnosticFields, diagnosticEntry } from '@release-maestro/core'

function write(entry: DiagnosticEntry): void {
    // Keep DevTools useful in desktop and web builds, at every log level.
    console[entry.level](`[${entry.scope}] ${entry.event}`, entry.fields)

    if (!window.process?.type || typeof window.require !== 'function') return
    try {
        const ipcRenderer = window.require('electron').ipcRenderer as AppIpcRenderer
        ipcRenderer.send('diagnostics:log', entry)
    } catch {
        // Logging must not break the action or error handler that called it.
    }
}

export function createRendererLogger(scope: string) {
    return {
        debug: (event: string, fields?: DiagnosticFields) =>
            write(diagnosticEntry('debug', scope, event, fields)),
        info: (event: string, fields?: DiagnosticFields) =>
            write(diagnosticEntry('info', scope, event, fields)),
        warn: (event: string, fields?: DiagnosticFields) =>
            write(diagnosticEntry('warn', scope, event, fields)),
        error: (event: string, error: unknown, fields?: DiagnosticFields) =>
            write(diagnosticEntry('error', scope, event, fields, error)),
    }
}
