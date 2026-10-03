let cleanup: Promise<void> | null = null

/** All exit routes drain the import before closing its dependencies, at most once. */
export function cleanupApplication(): Promise<void> {
    cleanup ??= (async () => {
        const { diContainer } = await import('./di')
        const { EmailImportService } = await import('./services/feed/email-import.service')
        const importService = await diContainer.get(EmailImportService)
        await importService.stop()
        await diContainer.destroyAll()
    })().catch(error => console.error('Error during cleanup:', error))

    return cleanup
}
