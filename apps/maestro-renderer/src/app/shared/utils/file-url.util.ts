const setFileUrlPath = (url: URL, path: string): string => {
    // URL.pathname encodes spaces, unicode, query and fragment delimiters, but
    // treats an existing `%` escape as intentional. Escape literal `%` first.
    url.pathname = path.replace(/%/g, '%25')
    return url.href
}

/**
 * Convert an absolute filesystem path into a `file://` URL usable as an `img src`.
 * Supports POSIX, Windows drive-letter, and Windows UNC paths.
 */
export const fileUrl = (path: string): string => {
    const normalized = path.replace(/\\/g, '/')

    if (normalized.startsWith('//')) {
        const hostEnd = normalized.indexOf('/', 2)
        const host = hostEnd === -1 ? normalized.slice(2) : normalized.slice(2, hostEnd)
        const pathname = hostEnd === -1 ? '/' : normalized.slice(hostEnd)
        return setFileUrlPath(new URL(`file://${host}`), pathname)
    }

    const pathname = /^[A-Za-z]:\//.test(normalized) ? `/${normalized}` : normalized
    return setFileUrlPath(new URL('file://'), pathname)
}
