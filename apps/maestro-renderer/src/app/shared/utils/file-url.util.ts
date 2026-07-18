/**
 * Convert an absolute filesystem path into a `file://` URL usable as an `img src`.
 * Handles spaces, unicode, `#` and `?` (which `encodeURI` leaves alone but would
 * be parsed as fragment/query in a URL).
 */
export const fileUrl = (path: string): string =>
    'file://' + encodeURI(path.replace(/\\/g, '/')).replace(/#/g, '%23').replace(/\?/g, '%3F')
