import { execFile, spawn } from 'child_process'
import { app } from 'electron'
import * as fs from 'fs/promises'
import { join } from 'path'
import { createInterface } from 'readline'
import { Observable, Subject } from 'rxjs'
import { Email, EmailImportStreamPacket, emailSchema } from '@release-maestro/core'
import { appPaths } from '../../app-env'
import type { EmailImporterPlugin } from './email.backend.repository'

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

const runAppleScript = (source: string): Promise<string> =>
    new Promise((resolve, reject) => {
        execFile('osascript', ['-e', source], (error, stdout) =>
            error ? reject(error) : resolve(stdout.trim()),
        )
    })

/** Errs towards "running": quitting a Mail the user opened would be worse than leaving ours open. */
const isMailRunning = (): Promise<boolean> =>
    runAppleScript('application "Mail" is running').then(
        output => output !== 'false',
        error => {
            console.error('[AppleMailImporter] Could not tell whether Mail is running:', error)
            return true
        },
    )

const quitMail = (): Promise<void> =>
    runAppleScript('if application "Mail" is running then tell application "Mail" to quit').then(
        () => undefined,
        error => console.error('[AppleMailImporter] Could not quit Mail:', error),
    )

export class AppleMailRepository implements EmailImporterPlugin {
    loadEmails(
        abortSignal: AbortSignal,
        mailboxName: string | null,
        receivedSince: Date | null,
    ): Observable<EmailImportStreamPacket> {
        const result$ = new Subject<EmailImportStreamPacket>()

        if (!mailboxName) {
            result$.error(new Error('[AppleMailImporter] Mailbox name is not set in settings'))
            return result$
        }

        const appleScriptPath = join(appPaths.resources, 'apple-scripts', 'export-emails.applescript')

        void Promise.all([fs.mkdtemp(join(app.getPath('temp'), 'apple-mail-export-')), isMailRunning()]).then(
            ([exportPath, wasMailRunning]) => {
                const args = [appleScriptPath, mailboxName, exportPath]
                if (receivedSince) args.push(formatAppleScriptDate(receivedSince))

                // spawn rather than exec: exec buffers all output and kills the export past 1 MB of it
                const childProcess = spawn('osascript', args, { signal: abortSignal })

                // An import may only be marked as covered once every exported email reached the
                // stream, so lines are handled in order and the stream settles only after the last one.
                // A line that fails does not stop the export, but fails it once the rest is handled.
                let handledLines = Promise.resolve()
                let lineFailure: Error | null = null
                const unhandledOutput: string[] = []
                createInterface({ input: childProcess.stderr }).on('line', line => {
                    handledLines = handledLines
                        .then(() => this.handleExportLine(line, result$, unhandledOutput))
                        .catch((error: unknown) => {
                            console.error('[AppleMailImporter] ', error)
                            lineFailure ??= error instanceof Error ? error : new Error(String(error))
                        })
                })
                childProcess.stdout.on('data', data => {
                    console.log('[AppleMailImporter] ', String(data).replace(/\n$/, ''))
                })

                let isSettled = false
                /** `getError` runs once every line is handled, so it sees all of the script's output. */
                const settle = (getError: () => Error | null) => {
                    if (isSettled) return
                    isSettled = true

                    void handledLines.then(async () => {
                        const error = getError() ?? lineFailure
                        // The export opens Mail if it is closed. Close it again before the stream
                        // settles, so a following import sees Mail as the user left it.
                        if (!wasMailRunning) await quitMail()

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
                    if (childProcess.pid === undefined) settle(() => error)
                })
                childProcess.on('close', exitCode => {
                    settle(
                        () =>
                            spawnError ?? (exitCode === 0 ? null : toExportError(exitCode, unhandledOutput)),
                    )
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
            fs.readFile(filePath, 'utf-8').catch((error: unknown) => {
                console.error('[AppleMailImporter] Error reading data file', filePath, ':', error)
                throw new Error(`[AppleMailImporter] Could not read exported email ${filePath}`)
            }),
            fs.readFile(filePath.replace(/\.txt$/, '.html'), 'utf-8').catch(() => {
                // HTML file may not exist if the email had no HTML body
                return ''
            }),
        ])
        const email = parseAppleMailFile(dataFileContents, htmlFileContents)
        if (!email) {
            // The script reports an email even when writing its file failed, so treat a file that
            // does not parse as an incomplete export
            throw new Error(`[AppleMailImporter] Could not parse exported email ${filePath}`)
        }
        result$.next({ current: Number(current), total: Number(total), email })
    }
}
