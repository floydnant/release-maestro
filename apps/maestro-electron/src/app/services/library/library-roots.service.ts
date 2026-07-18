import { access, realpath, stat } from 'node:fs/promises'
import { constants } from 'node:fs'
import { isAbsolute, relative, resolve, sep } from 'node:path'
import { LibraryRootValidation } from '@release-maestro/core'

/**
 * Canonicalizes and validates library root folders.
 *
 * Canonicalization uses `realpath` so symlinked/aliased selections of the same
 * directory collapse to one root; when `realpath` fails (path doesn't exist),
 * the path is still resolved deterministically so results are stable. Validation
 * additionally checks that each root is a readable directory and flags roots
 * nested beneath another root in the same set (scanning both is redundant).
 */
export class LibraryRootsService {
    /** Canonical form of a single path; deterministic even when the path doesn't exist. */
    async canonicalize(path: string): Promise<string> {
        return realpath(path).catch(() => resolve(path))
    }

    /**
     * Canonicalize a picker selection: canonical paths, deduplicated, input order
     * preserved (first occurrence wins).
     */
    async canonicalizeSelection(paths: string[]): Promise<string[]> {
        const canonical = await Promise.all(paths.map(path => this.canonicalize(path)))
        return [...new Set(canonical)]
    }

    /** Validate a set of roots. Results are returned in the same order as the input. */
    async validate(paths: string[]): Promise<LibraryRootValidation[]> {
        const canonicalPaths = await Promise.all(paths.map(path => this.canonicalize(path)))

        return Promise.all(
            paths.map(async (path, index): Promise<LibraryRootValidation> => {
                const canonicalPath = canonicalPaths[index] as string
                const nestedUnder = canonicalPaths.find(
                    (other, otherIndex) =>
                        otherIndex !== index &&
                        // Identical duplicates count as "nested" only for later occurrences,
                        // so exactly one of an identical pair survives.
                        ((other === canonicalPath && otherIndex < index) ||
                            (other !== canonicalPath && isPathContainedIn(other, canonicalPath))),
                )

                const availability = await this.checkAvailability(canonicalPath)
                return {
                    path,
                    canonicalPath,
                    available: availability.available,
                    ...(nestedUnder !== undefined ? { nestedUnder } : {}),
                    ...(availability.error !== undefined ? { error: availability.error } : {}),
                }
            }),
        )
    }

    private async checkAvailability(path: string): Promise<{ available: boolean; error?: string }> {
        try {
            const stats = await stat(path)
            if (!stats.isDirectory()) return { available: false, error: 'Not a folder' }
            await access(path, constants.R_OK)
            return { available: true }
        } catch (error) {
            return { available: false, error: describeFsError(error) }
        }
    }
}

/** True when `candidate` lives strictly inside `parent`. */
const isPathContainedIn = (parent: string, candidate: string): boolean => {
    const relativePath = relative(parent, candidate)
    return (
        relativePath !== '' &&
        relativePath !== '..' &&
        !relativePath.startsWith(`..${sep}`) &&
        !isAbsolute(relativePath)
    )
}

// Matched on the `code` property (not `instanceof Error`) — fs errors can cross
// realm boundaries (e.g. jest sandboxes) where instanceof fails.
const describeFsError = (error: unknown): string => {
    const code =
        typeof error === 'object' && error !== null && 'code' in error
            ? (error as { code?: string }).code
            : undefined
    switch (code) {
        case 'ENOENT':
            return 'Folder not found (is the drive connected?)'
        case 'EACCES':
        case 'EPERM':
            return 'No permission to read this folder'
        default:
            return error instanceof Error ? error.message : String(error)
    }
}
