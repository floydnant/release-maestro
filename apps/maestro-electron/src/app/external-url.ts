import { shell } from 'electron'

const externalUrlProtocols = new Set(['http:', 'https:'])

const isSafeExternalUrl = (url: string) => {
    try {
        return externalUrlProtocols.has(new URL(url).protocol)
    } catch {
        return false
    }
}

/**
 * Opens a URL outside the app; the `open-url` IPC, popups and cross-origin navigation all use it.
 * Only HTTP(S) URLs pass, since `shell.openExternal` hands any other scheme to a local handler.
 */
export const openUrlInNativeBrowser = (url: string) => {
    if (!isSafeExternalUrl(url)) {
        console.warn('Refused to open a non-HTTP(S) URL in the native browser:', url)
        return
    }

    void shell.openExternal(url).catch(error => {
        console.error('Failed to open URL in the native browser:', error)
    })
}
