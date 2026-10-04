import { diagnosticEntry, diagnosticErrorSummary, parseDiagnosticEntry } from './diagnostic-log'

describe('diagnostic logs', () => {
    it('removes private paths, URLs, and email addresses from error fields', () => {
        const error = new Error(
            'Could not read /Users/alice/Music/private.flac at https://example.com/?token=abc',
        )
        error.stack = 'Error: alice@example.com\n at read (/Users/alice/app/main.js:42:1)'

        const entry = diagnosticEntry('error', 'metadata', 'metadata.read.failed', {}, error)

        expect(JSON.stringify(entry)).not.toContain('/Users/alice')
        expect(JSON.stringify(entry)).not.toContain('token=abc')
        expect(JSON.stringify(entry)).not.toContain('alice@example.com')
        expect(entry.fields).toMatchObject({ errorName: 'Error' })
    })

    it('rejects nested renderer payloads and bounds string fields', () => {
        expect(
            parseDiagnosticEntry({
                level: 'info',
                scope: 'feed',
                event: 'feed.loaded',
                fields: { settings: { private: 'value' } },
            }),
        ).toBeNull()

        const parsed = parseDiagnosticEntry({
            level: 'warn',
            scope: 'feed',
            event: 'feed.failed',
            fields: { message: 'x'.repeat(10_000) },
        })
        expect(parsed?.fields['message']).toHaveLength(2_000)
    })

    it('removes filenames that contain spaces', () => {
        const entry = diagnosticEntry(
            'error',
            'library',
            'library.file.failed',
            {},
            new Error("open '/Users/alice/Music/My Secret Song.flac' failed"),
        )

        expect(JSON.stringify(entry)).not.toContain('Secret Song.flac')
    })

    it('removes filenames with apostrophes', () => {
        const entry = diagnosticEntry(
            'error',
            'library',
            'library.file.failed',
            {},
            new Error("open /Users/alice/Music/Alice's Secret Album/track.flac"),
        )

        expect(JSON.stringify(entry)).not.toContain('Secret Album')
    })

    it('removes UNC paths', () => {
        const entry = diagnosticEntry(
            'error',
            'library',
            'library.file.failed',
            {},
            new Error('open \\\\nas\\Alice\\Private Album\\track.flac'),
        )

        expect(JSON.stringify(entry)).not.toContain('Private Album')
        expect(JSON.stringify(entry)).not.toContain('track.flac')
    })

    it('keeps the error type and code without a sensitive message', () => {
        const error = Object.assign(new Error('Can’t get mailbox "Private purchases"'), {
            code: 'APPLE_MAIL_EXPORT_FAILED',
        })

        expect(diagnosticErrorSummary(error)).toEqual({
            errorName: 'Error',
            errorCode: 'APPLE_MAIL_EXPORT_FAILED',
        })
    })
})
