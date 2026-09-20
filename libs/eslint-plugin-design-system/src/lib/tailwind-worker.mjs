import { __unstable__loadDesignSystem, compile } from '@tailwindcss/node'
import { readFile, stat } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { dirname } from 'node:path'
import { runAsWorker } from 'synckit'

const designSystems = new Map()
const require = createRequire(import.meta.url)

async function fingerprint(path) {
    try {
        const metadata = await stat(path, { bigint: true })
        return `${metadata.mtimeNs}:${metadata.size}`
    } catch {
        return null
    }
}

async function isCurrent(entry) {
    for (const [path, previous] of entry.dependencies) {
        if ((await fingerprint(path)) !== previous) return false
    }
    return true
}

async function getDesignSystem(stylesheetPath) {
    const cached = designSystems.get(stylesheetPath)
    if (cached && (await isCurrent(cached))) return cached
    if (cached) {
        for (const path of cached.dependencies.keys()) delete require.cache[path]
    }

    const base = dirname(stylesheetPath)
    const css = await readFile(stylesheetPath, 'utf8')
    const paths = new Set([stylesheetPath])
    await compile(css, { base, onDependency: path => paths.add(path) })

    const designSystem = await __unstable__loadDesignSystem(css, { base })
    const dependencies = new Map(
        await Promise.all([...paths].map(async path => [path, await fingerprint(path)])),
    )
    const loaded = { dependencies, designSystem }
    designSystems.set(stylesheetPath, loaded)
    return loaded
}

runAsWorker(async ({ operation, stylesheetPath, value }) => {
    const authority = await getDesignSystem(stylesheetPath)
    const { designSystem } = authority

    switch (operation) {
        case 'authority':
            return {
                classList: designSystem.getClassList().map(([className]) => className),
                dependencies: [...authority.dependencies],
            }
        case 'isClass':
            return designSystem.candidatesToCss([value])[0] !== null
        case 'isThemeVariable':
            return designSystem.theme.get([value]) !== null
        default:
            throw new Error(`Unknown Tailwind worker operation: ${operation}`)
    }
})
