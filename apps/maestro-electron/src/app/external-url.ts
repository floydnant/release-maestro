import { shell } from 'electron'

const isSafeExternalUrl = (url: string) => {
    try {
        return ['http:', 'https:'].includes(new URL(url).protocol)
    } catch {
        return false
    }
}

export const openUrlInNativeBrowser = (url: string) => {
    if (!isSafeExternalUrl(url)) return

    void shell.openExternal(url).catch(error => {
        console.error('Failed to open URL in the native browser:', error)
    })
}
