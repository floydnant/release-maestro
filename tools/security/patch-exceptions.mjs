import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { parseAllDocuments } from 'yaml'
import { sha256 } from './install.mjs'

// A local patch allowance is valid only for the reviewed bytes and their locked application.
// Frozen installs and CI regression tests verify that pnpm applies those bytes correctly.
export const verifyPatchExceptions = (exceptions, root) => {
    const patched = exceptions.filter(exception => exception.patch)
    if (!patched.length) return
    const readYaml = file =>
        parseAllDocuments(readFileSync(join(root, file), 'utf8')).map(document => {
            if (document.errors.length) throw document.errors[0]
            return document.toJS()
        })
    const workspace = readYaml('pnpm-workspace.yaml')[0]
    const locks = readYaml('pnpm-lock.yaml')
    for (const exception of patched) {
        const { path, sha256: digest } = exception.patch
        const pkg = `${exception.name}@${exception.version}`
        const snapshots = locks.flatMap(lock =>
            Object.keys(lock.snapshots ?? {})
                .filter(key => key === pkg || key.startsWith(`${pkg}(`))
                .map(key => ({ key, digest: lock.patchedDependencies?.[pkg] })),
        )
        if (
            sha256(readFileSync(join(root, path))) !== digest ||
            workspace.patchedDependencies?.[pkg] !== path ||
            !snapshots.length ||
            snapshots.some(
                snapshot => snapshot.digest !== digest || !snapshot.key.includes(`(patch_hash=${digest})`),
            )
        ) {
            throw new Error(`Security patch verification failed: ${pkg} ${exception.id}`)
        }
    }
}
