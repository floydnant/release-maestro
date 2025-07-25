import { exec } from 'child_process'
import { app } from 'electron'
import * as fs from 'fs/promises'
import { join } from 'path'
import { Observable, Subject } from 'rxjs'
import { Email, EmailImporterPlugin, EmailImportStreamPacket, emailSchema } from '../email.schema'

const parseAppleMailFile = (dataFileContents: string, htmlFileContents: string): Email | null => {
    const data = {
        vendor: 'APPLE_MAIL',
    } as Email & Record<string, unknown>
    const [frontMatter, plainTextBody] = dataFileContents.split(
        '==========================================\n==========================================',
    )
    data.plainBody = plainTextBody?.trim() || ''
    data.htmlBody = htmlFileContents
        ?.replace(/^(.|\n)*Content-Type: text\/html\; charset=.+\nContent-Transfer-Encoding: .+\n/, '')
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
    const validationResult = emailSchema.safeParse(data)
    if (!validationResult.success) {
        console.error(`Invalid email data: ${JSON.stringify(validationResult.error)}`)
        return null
    }

    return validationResult.data
}

export class AppleMailRepository implements EmailImporterPlugin {
    loadEmails(abortSignal: AbortSignal): Observable<EmailImportStreamPacket> {
        // @TODO: this needs to be configurable via some plugin config mechanism
        const mailboxName = 'Bandcamp'

        const result$ = new Subject<EmailImportStreamPacket>()

        const exportPath = join(app.getPath('temp'), 'apple-mail-export')
        // @TODO: this may need to be fixed for production builds
        const appleScriptPath = join(process.cwd(), 'apple-scripts', 'export-emails.applescript')

        const childProcess = exec(
            `osascript "${appleScriptPath}" "${mailboxName}" "${exportPath}"`,
            { signal: abortSignal },
            error => {
                if (error) {
                    // Only forward the error if it wasn't due to the abort signal
                    if (!abortSignal.aborted) {
                        console.error('[AppleMailImporter] ', error)
                        result$.error(error)
                    }
                }

                result$.complete()

                fs.rm(exportPath, { recursive: true }).catch(err => {
                    console.error('[AppleMailImporter] Error removing export directory', exportPath, ':', err)
                })
            },
        )

        childProcess.stdout?.on('data', async data => {
            const str = String(data)
            console.log('[AppleMailImporter] ', str.replace(/\n$/, ''))
        })
        childProcess.stderr?.on('data', async data => {
            const str = String(data)

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
                    fs.readFile(filePath.replace(/\.txt$/, '.html'), 'utf-8').catch(err => {
                        console.error(
                            '[AppleMailImporter] Error reading HTML file',
                            filePath.replace(/\.txt$/, '.html'),
                            ':',
                            err,
                        )
                        return null
                    }),
                ])
                if (!dataFileContents || !htmlFileContents) {
                    return
                }

                const email = parseAppleMailFile(dataFileContents, htmlFileContents)
                if (email) {
                    result$.next({ current: Number(current), total: Number(total), email })
                } else {
                    console.error('[AppleMailImporter] Failed to parse email from', filePath)
                }
            } else {
                console.error('[AppleMailImporter] ', str.replace(/\n$/, ''))
            }
        })

        return result$
    }
}
