/** A missing entry or non-directory ancestor cannot resolve to a file. */
export const isAbsentPathError = (error: unknown): boolean =>
    typeof error == 'object' &&
    error != null &&
    'code' in error &&
    (error.code == 'ENOENT' || error.code == 'ENOTDIR')
