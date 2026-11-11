import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { parseAllDocuments } from 'yaml'
import { sha256 } from './install.mjs'

// Security patch regression tests live here, one allowance owning each file.
export const patchTestDirectory = 'tools/patches'

// A local patch allowance is valid only for the reviewed bytes and their locked application.
// Frozen installs and CI regression tests verify that pnpm applies those bytes correctly.
export const verifyPatchExceptions = (exceptions, root) => {
    const readYaml = file =>
        parseAllDocuments(readFileSync(join(root, file), 'utf8')).map(document => {
            if (document.errors.length) throw document.errors[0]
            return document.toJS()
        })
    const workspace = readYaml('pnpm-workspace.yaml')[0] ?? {}
    const patched = exceptions.filter(exception => exception.patch)
    const listed = directory =>
        existsSync(join(root, directory))
            ? readdirSync(join(root, directory)).map(file => `${directory}/${file}`)
            : []

    // A patch file or patch test that nothing owns lingers after its fix: it would keep testing a
    // dependency the repository no longer patches. Removal of an allowance must take both with it.
    const referenced = new Set([
        ...Object.values(workspace.patchedDependencies ?? {}),
        ...patched.flatMap(exception => [exception.patch.path, ...(exception.patch.tests ?? [])]),
    ])
    const orphans = [...listed('patches'), ...listed(patchTestDirectory)].filter(
        file => !referenced.has(file),
    )
    if (orphans.length)
        throw new Error(
            `Unowned security patch files: ${orphans.join(', ')}. Remove them, or register the patch and list its tests in its allowance.`,
        )

    if (!patched.length) return
    const locks = readYaml('pnpm-lock.yaml')
    for (const exception of patched) {
        const { path, sha256: digest, tests } = exception.patch
        const pkg = `${exception.name}@${exception.version}`
        const snapshots = locks.flatMap(lock =>
            Object.keys(lock.snapshots ?? {})
                .filter(key => key === pkg || key.startsWith(`${pkg}(`))
                .map(key => ({ key, digest: lock.patchedDependencies?.[pkg] })),
        )
        // Like any exception for a resolved finding, an allowance whose version is neither locked nor
        // registered accepts nothing. Upgrading past the patched version leaves it stale until removal.
        if (!snapshots.length && !workspace.patchedDependencies?.[pkg]) continue
        if (
            sha256(readFileSync(join(root, path))) !== digest ||
            workspace.patchedDependencies?.[pkg] !== path ||
            !snapshots.length ||
            snapshots.some(
                snapshot => snapshot.digest !== digest || !snapshot.key.includes(`(patch_hash=${digest})`),
            ) ||
            tests.some(test => !existsSync(join(root, test)))
        ) {
            throw new Error(`Security patch verification failed: ${pkg} ${exception.id}`)
        }
    }
}
