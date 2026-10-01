import { spawn } from 'child_process'
import { app } from 'electron'
import * as fs from 'fs/promises'
import { join } from 'path'
import { createInterface } from 'readline'
import { Observable, Subject } from 'rxjs'
import { Email, EmailImportStreamPacket, emailSchema } from '@release-maestro/core'
import { appPaths } from '../../app-env'
import type { EmailImporterPlugin } from './email.backend.repository'
import { SettingsBackendService } from '../settings.backend.service'

const validateEmail = (data: unknown): Email | null => {
    const result = emailSchema.safeParse(data)
    return result.success ? result.data : null
}

const parseAppleMailFile = (dataFileContents: string, htmlFileContents: string): Email | null => {
    const data = {
        vendor: 'APPLE_MAIL',
    } as Email & Record<string, unknown>
    const [frontMatter, plainTextBody] = dataFileContents.split(
        '==========================================\n==========================================',
    )
    data.plainBody = plainTextBody?.trim() || ''
    data.htmlBody = htmlFileContents
        ?.replace(/^(.|\n)*Content-Type: text\/html; charset=.+\nContent-Transfer-Encoding: .+\n/, '')
        .replace(/--it_was_only_a_kiss--/g, '') // What the heck is this?
        .trim()

    for (const line of frontMatter?.trim().split('\n') || []) {
        const key = line.match(/^(\w+)+: /)?.[1]
        if (!key) continue

        const value = line.replace(/^\w+: /, '').trim()
        data[key] = value

        if (value == 'false') {
            data[key] = false
        } else if (value == 'true') {
            data[key] = true
        }
    }

    return validateEmail(data)
}

const padTwoDigits = (value: number) => String(value).padStart(2, '0')

/** The local `YYYY-MM-DDTHH:MM:SS` form the export script writes `dateReceived` in and reads back. */
export const formatAppleScriptDate = (date: Date): string =>
    `${date.getFullYear()}-${padTwoDigits(date.getMonth() + 1)}-${padTwoDigits(date.getDate())}` +
    `T${padTwoDigits(date.getHours())}:${padTwoDigits(date.getMinutes())}:${padTwoDigits(date.getSeconds())}`

const toExportError = (exitCode: number | null, unhandledOutput: string[]): Error => {
    const mailError = unhandledOutput
        .map(line => line.match(/Mail got an error: (.+)/)?.[1])
        .find(message => message !== undefined)

    return new Error(
        `[AppleMailImporter] ${mailError ?? unhandledOutput.at(-1) ?? `osascript exited with code ${exitCode}`}`,
    )
}

export class AppleMailRepository implements EmailImporterPlugin {
    constructor(private settings: SettingsBackendService) {}

    loadEmails(abortSignal: AbortSignal, receivedSince: Date | null): Observable<EmailImportStreamPacket> {
        const result$ = new Subject<EmailImportStreamPacket>()

        const mailboxName = this.settings.getSettings().emailPluginConfig?.APPLE_MAIL?.mailboxName
        if (!mailboxName) {
            result$.error(new Error('[AppleMailImporter] Mailbox name is not set in settings'))
            return result$
        }

        const appleScriptPath = join(appPaths.resources, 'apple-scripts', 'export-emails.applescript')

        void fs.mkdtemp(join(app.getPath('temp'), 'apple-mail-export-')).then(
            exportPath => {
                const args = [appleScriptPath, mailboxName, exportPath]
                if (receivedSince) args.push(formatAppleScriptDate(receivedSince))

                // spawn rather than exec: exec buffers all output and kills the export past 1 MB of it
                const childProcess = spawn('osascript', args, { signal: abortSignal })

                // An import may only be marked as covered once every exported email reached the
                // stream, so lines are handled in order and the stream settles only after the last one.
                let handledLines = Promise.resolve()
                const unhandledOutput: string[] = []
                createInterface({ input: childProcess.stderr }).on('line', line => {
                    handledLines = handledLines.then(() =>
                        this.handleExportLine(line, result$, unhandledOutput),
                    )
                })
                childProcess.stdout.on('data', data => {
                    console.log('[AppleMailImporter] ', String(data).replace(/\n$/, ''))
                })

                let isSettled = false
                const settle = (error: Error | null) => {
                    if (isSettled) return
                    isSettled = true

                    void handledLines.then(() => {
                        // An aborted export completes rather than errors: the user asked it to stop
                        if (error && !abortSignal.aborted) {
                            console.error('[AppleMailImporter] ', error.message)
                            result$.error(error)
                        } else {
                            result$.complete()
                        }

                        fs.rm(exportPath, { recursive: true }).catch(err => {
                            console.error(
                                '[AppleMailImporter] Error removing export directory',
                                exportPath,
                                ':',
                                err,
                            )
                        })
                    })
                }

                let spawnError: Error | null = null
                childProcess.on('error', error => {
                    spawnError = error
                    // A process that never started emits no 'close' to wait for
                    if (childProcess.pid === undefined) settle(error)
                })
                childProcess.on('close', exitCode => {
                    settle(spawnError ?? (exitCode === 0 ? null : toExportError(exitCode, unhandledOutput)))
                })
            },
            error => {
                result$.error(error)
            },
        )

        return result$
    }

    private async handleExportLine(
        line: string,
        result$: Subject<EmailImportStreamPacket>,
        unhandledOutput: string[],
    ): Promise<void> {
        const match = line.match(/Processed email (\d+)\/(\d+): (.+)/)
        if (!match) {
            console.error('[AppleMailImporter] ', line)
            unhandledOutput.push(line)
            return
        }

        const [, current, total, filePath] = match
        if (!filePath) {
            console.error('[AppleMailImporter] No file path found in output:', line)
            return
        }

        const [dataFileContents, htmlFileContents] = await Promise.all([
            fs.readFile(filePath, 'utf-8').catch(err => {
                console.error('[AppleMailImporter] Error reading data file', filePath, ':', err)
                return null
            }),
            fs.readFile(filePath.replace(/\.txt$/, '.html'), 'utf-8').catch(() => {
                // HTML file may not exist if the email had no HTML body
                return ''
            }),
        ])
        if (!dataFileContents) {
            return
        }

        const email = parseAppleMailFile(dataFileContents, htmlFileContents)
        if (email) {
            result$.next({ current: Number(current), total: Number(total), email })
        } else {
            console.error('[AppleMailImporter] Failed to parse email from', filePath)
        }
    }
}
