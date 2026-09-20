import { __unstable__loadDesignSystem } from '@tailwindcss/node'
import { readFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { runAsWorker } from 'synckit'

const designSystems = new Map()

async function getDesignSystem(stylesheetPath) {
    let designSystem = designSystems.get(stylesheetPath)
    if (!designSystem) {
        const base = dirname(stylesheetPath)
        designSystem = await __unstable__loadDesignSystem(await readFile(stylesheetPath, 'utf8'), { base })
        designSystems.set(stylesheetPath, designSystem)
    }
    return designSystem
}

runAsWorker(async ({ operation, stylesheetPath, value }) => {
    const designSystem = await getDesignSystem(stylesheetPath)

    switch (operation) {
        case 'classList':
            return designSystem.getClassList().map(([className]) => className)
        case 'isClass':
            return designSystem.candidatesToCss([value])[0] !== null
        case 'isThemeVariable':
            return designSystem.theme.get([value]) !== null
        default:
            throw new Error(`Unknown Tailwind worker operation: ${operation}`)
    }
})
