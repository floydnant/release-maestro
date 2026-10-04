import {
    asAppIpcMain,
    DiagnosticEntry,
    DiagnosticFields,
    diagnosticEntry,
    parseDiagnosticEntry,
} from '@release-maestro/core'
import { app, ipcMain } from 'electron'
import electronLog from 'electron-log/main'
import { randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

const sessionId = randomUUID()
const LOG_FILE_NAME = 'main.log'
const LOG_SIZE_BYTES = 5 * 1024 * 1024

export const diagnosticLogDirectory = (): string => {
    // Resolve only at startup. Most service unit tests never initialize file logging.
    const { appPaths } = require('../app-env') as typeof import('../app-env')
    return appPaths.log
}
export const diagnosticLogFiles = (): [string, string] => {
    const directory = diagnosticLogDirectory()
    return [join(directory, 'main.old.log'), join(directory, LOG_FILE_NAME)]
}

let initialized = false

export const isDebugLoggingEnabled = (): boolean =>
    process.env['RELEASE_MAESTRO_LOG_LEVEL'] === 'debug' || !app.isPackaged

/** Configure before app services start, so the first startup failure reaches a file. */
export function initializeLogging(): void {
    if (initialized) return
    initialized = true

    electronLog.transports.file.resolvePathFn = () => diagnosticLogFiles()[1]
    electronLog.transports.file.maxSize = LOG_SIZE_BYTES
    electronLog.transports.file.level = isDebugLoggingEnabled() ? 'debug' : 'info'
    electronLog.transports.file.writeOptions = { encoding: 'utf8', flag: 'a', mode: 0o600 }
    electronLog.transports.file.format = ({ message }) => [
        JSON.stringify({
            time: message.date.toISOString(),
            level: message.level,
            sessionId,
            ...(message.data[0] as object),
        }),
    ]
    electronLog.transports.console.level = 'debug'
    electronLog.transports.ipc.level = false

    asAppIpcMain(ipcMain).on('diagnostics:log', (_event, value) => {
        const entry = parseDiagnosticEntry(value)
        if (entry) writeDiagnosticEntry(entry, 'renderer')
    })
    process.on('uncaughtExceptionMonitor', error => {
        createMainLogger('process').error('process.uncaught-exception', error)
    })
    app.on('render-process-gone', (_event, _webContents, details) => {
        createMainLogger('electron').error('renderer.process-gone', new Error(details.reason), {
            reason: details.reason,
            exitCode: details.exitCode,
        })
    })
    app.on('child-process-gone', (_event, details) => {
        createMainLogger('electron').warn('electron.child-process-gone', {
            type: details.type,
            reason: details.reason,
            exitCode: details.exitCode,
        })
    })
}

export function writeDiagnosticEntry(entry: DiagnosticEntry, source: 'main' | 'renderer' | 'worker'): void {
    const record = { source, scope: entry.scope, event: entry.event, fields: entry.fields }
    if (initialized) electronLog[entry.level](record)
    else console[entry.level](`[${source}:${entry.scope}] ${entry.event}`, entry.fields)
}

export function createMainLogger(scope: string) {
    return {
        debug: (event: string, fields?: DiagnosticFields) =>
            writeDiagnosticEntry(diagnosticEntry('debug', scope, event, fields), 'main'),
        info: (event: string, fields?: DiagnosticFields) =>
            writeDiagnosticEntry(diagnosticEntry('info', scope, event, fields), 'main'),
        warn: (event: string, fields?: DiagnosticFields) =>
            writeDiagnosticEntry(diagnosticEntry('warn', scope, event, fields), 'main'),
        error: (event: string, error: unknown, fields?: DiagnosticFields) =>
            writeDiagnosticEntry(diagnosticEntry('error', scope, event, fields, error), 'main'),
        errorEvent: (event: string, fields?: DiagnosticFields) =>
            writeDiagnosticEntry(diagnosticEntry('error', scope, event, fields), 'main'),
    }
}

/** Files are bounded by the file transport. Read the old file first to preserve time order. */
export async function readDiagnosticLines(): Promise<string[]> {
    const files = await Promise.all(
        diagnosticLogFiles().map(async path => {
            try {
                return await readFile(path, 'utf8')
            } catch (error) {
                if ((error as NodeJS.ErrnoException).code === 'ENOENT') return ''
                throw error
            }
        }),
    )
    return files.flatMap(text => text.split('\n').filter(Boolean))
}
