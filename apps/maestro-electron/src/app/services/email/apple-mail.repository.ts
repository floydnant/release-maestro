import { execFile } from 'child_process'
import { app } from 'electron'
import * as fs from 'fs/promises'
import { join } from 'path'
import { concatMap, defaultIfEmpty, lastValueFrom, Observable, Subject } from 'rxjs'
import { Email, EmailImportStreamPacket, emailSchema } from '@release-maestro/core'
import { appPaths } from '../../app-env'
import { SettingsBackendService } from '../settings.backend.service'
import { createAppleMailExportDirectory, removeAppleMailExportDirectory } from './apple-mail-export-directory'
// Import will be fixed after creating email.backend.repository.ts
export interface EmailImporterPlugin {
    loadEmails(signal: AbortSignal): Observable<EmailImportStreamPacket>
}

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

export class AppleMailRepository implements EmailImporterPlugin {
    constructor(private settings: SettingsBackendService) {}

    loadEmails(abortSignal: AbortSignal): Observable<EmailImportStreamPacket> {
        const result$ = new Subject<EmailImportStreamPacket>()

        const mailboxName = this.settings.getSettings().emailPluginConfig?.APPLE_MAIL?.mailboxName
        if (!mailboxName) {
            result$.error(new Error('[AppleMailImporter] Mailbox name is not set in settings'))
            return result$
        }

        if (abortSignal.aborted) {
            result$.complete()
            return result$
        }
        void this.exportEmails(mailboxName, abortSignal, result$).then(
            () => result$.complete(),
            error => {
                if (abortSignal.aborted) {
                    result$.complete()
                    return
                }
                const parsedErrorMessage =
                    error instanceof Error ? error.message.match(/Mail got an error: (.+)/)?.[1] : undefined
                result$.error(
                    parsedErrorMessage ? new Error(`[AppleMailImporter] ${parsedErrorMessage}`) : error,
                )
            },
        )

        return result$
    }

    private async exportEmails(
        mailboxName: string,
        abortSignal: AbortSignal,
        result$: Subject<EmailImportStreamPacket>,
    ): Promise<void> {
        const appleScriptPath = join(appPaths.resources, 'apple-scripts', 'export-emails.applescript')

        const exportPath = await createAppleMailExportDirectory(app.getPath('temp'))

        const output$ = new Subject<string>()
        const readsDone = lastValueFrom(
            output$.pipe(
                concatMap(str =>
                    this.readExport(str, abortSignal, result$).catch(error => {
                        console.error('[AppleMailImporter] Error reading export', error)
                    }),
                ),
                defaultIfEmpty(undefined),
            ),
        )
        try {
            if (abortSignal.aborted) return
            await new Promise<void>((resolve, reject) => {
                let processError: Error | null = null
                const childProcess = execFile(
                    'osascript',
                    [appleScriptPath, mailboxName, exportPath],
                    { signal: abortSignal },
                    error => {
                        processError = error
                    },
                )
                // An abort invokes the callback before the child has stopped writing files.
                childProcess.once('close', () => {
                    if (processError) reject(processError)
                    else resolve()
                })

                childProcess.stdout?.on('data', data => {
                    const str = String(data)
                    console.log('[AppleMailImporter] ', str.replace(/\n$/, ''))
                })
                childProcess.stderr?.on('data', data => output$.next(String(data)))
            })
        } finally {
            // Readers must finish before cleanup removes the files reported by the process.
            output$.complete()
            await readsDone
            await removeAppleMailExportDirectory(exportPath).catch(error => {
                console.error('[AppleMailImporter] Error removing export directory', exportPath, ':', error)
            })
        }
    }

    private async readExport(
        str: string,
        abortSignal: AbortSignal,
        result$: Subject<EmailImportStreamPacket>,
    ): Promise<void> {
        const match = str.match(/Processed email (\d+)\/(\d+): (.+)/)
        if (match) {
            const [_, current, total, filePath] = match
            if (!filePath) {
                console.error('[AppleMailImporter] No file path found in output:', str)
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
            if (email && !abortSignal.aborted) {
                result$.next({ current: Number(current), total: Number(total), email })
            } else if (!email) {
                console.error('[AppleMailImporter] Failed to parse email from', filePath)
            }
        } else {
            console.error('[AppleMailImporter] ', str.replace(/\n$/, ''))
        }
    }
}
