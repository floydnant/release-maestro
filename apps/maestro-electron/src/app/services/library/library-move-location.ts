import { readdir, stat, lstat } from 'node:fs/promises'
import { basename, dirname, relative, isAbsolute, parse, join } from 'node:path'

/** Distinguish an independent original from case aliases on case-insensitive filesystems. */
export const compareSongLocations = async (
    original: string,
    found: string,
    unavailableFolders: readonly string[],
): Promise<'moved' | 'copy' | 'unknown'> => {
    if (
        unavailableFolders.some(folder => {
            const child = relative(folder, original)
            return (
                child == '' ||
                (!isAbsolute(child) && child != '..' && !child.startsWith('../') && !child.startsWith('..\\'))
            )
        })
    )
        return 'unknown'
    const volume = await sourceVolumeRoot(original)
    if (volume) {
        try {
            const root = await stat(volume)
            if (!root.isDirectory()) return 'unknown'
            // A removable Unix mount can leave an empty directory after unmounting.
            if (process.platform != 'win32' && root.dev == (await stat(dirname(volume))).dev) {
                return 'unknown'
            }
        } catch {
            return 'unknown'
        }
    }
    const entry = await lstat(original).catch(error => (isAbsent(error) ? 'absent' : 'unknown'))
    if (entry == 'absent') {
        // ENOENT at the leaf can mean an ancestor symlink lost its target. Check
        // every ancestor, even above missing directories, before inferring absence.
        for (let path = dirname(original); ; path = dirname(path)) {
            const ancestor = await lstat(path).catch(error => (isAbsent(error) ? 'absent' : 'unknown'))
            if (ancestor == 'unknown') return 'unknown'
            if (ancestor != 'absent') {
                if (ancestor.isSymbolicLink()) {
                    const target = await stat(path).catch(() => null)
                    if (!target?.isDirectory()) return 'unknown'
                } else if (!ancestor.isDirectory()) return 'unknown'
            }
            if (dirname(path) == path) break
        }
        return 'moved'
    }
    if (entry == 'unknown') return 'unknown'
    try {
        const after = await lstat(found)
        if (
            original.toLowerCase() == found.toLowerCase() &&
            entry.ino != 0 &&
            entry.ino == after.ino &&
            entry.dev == after.dev
        ) {
            // realpath preserves input casing on macOS. Directory entries reveal the actual spelling.
            // Independent hardlinks and symlinks still have their own entry and remain copies.
            for (let path = original; dirname(path) != path; path = dirname(path)) {
                if (!(await readdir(dirname(path))).includes(basename(path))) return 'moved'
            }
        }
        return 'copy'
    } catch {
        return 'unknown'
    }
}

/** Standard external-volume roots remain relevant after their folder leaves settings. */
const sourceVolumeRoot = async (path: string): Promise<string | null> => {
    if (process.platform == 'win32') return parse(path).root || null
    const parts = path.split('/')
    if (parts[1] == 'Volumes' || parts[1] == 'mnt') return parts[2] ? join('/', parts[1], parts[2]) : null
    if (parts[1] == 'media' && parts[2]) {
        const directRoot = join('/', 'media', parts[2])
        try {
            // Linux desktops use both /media/<volume> and /media/<user>/<volume>.
            if ((await stat(directRoot)).dev != (await stat('/media')).dev) return directRoot
        } catch {
            return directRoot
        }
        return parts[3] ? join('/', ...parts.slice(1, 4)) : directRoot
    }
    if (parts[1] == 'run' && parts[2] == 'media') {
        return parts[4] ? join('/', ...parts.slice(1, 5)) : null
    }
    return null
}

const isAbsent = (error: unknown): boolean =>
    typeof error == 'object' &&
    error != null &&
    'code' in error &&
    (error.code == 'ENOENT' || error.code == 'ENOTDIR')
