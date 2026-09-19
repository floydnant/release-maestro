import * as fs from 'fs/promises'
import { join } from 'path'

const activeExportDirectories = new Set<string>()

const ownerIsRunning = (pid: number): boolean => {
    try {
        process.kill(pid, 0)
        return true
    } catch (error) {
        if (typeof error === 'object' && error !== null && 'code' in error) {
            if (error.code === 'ESRCH') return false
            if (error.code === 'EPERM') return true
        }
        throw error
    }
}

// The caller reserves exports within this process until child exit, reads, and cleanup finish.
export const createAppleMailExportDirectory = async (tempPath: string): Promise<string> => {
    // Older versions wrote every import here. A fresh import must remove those unowned leftovers.
    await fs.rm(join(tempPath, 'apple-mail-export'), { recursive: true, force: true })

    for (const entry of await fs.readdir(tempPath, { withFileTypes: true })) {
        const owner = /^apple-mail-export-([1-9]\d*)-[a-zA-Z0-9]+$/.exec(entry.name)
        if (!entry.isDirectory() || !owner) continue
        const pid = Number(owner[1])
        if (!Number.isSafeInteger(pid) || pid > 2147483647) continue
        const exportPath = join(tempPath, entry.name)
        if ((pid === process.pid && !activeExportDirectories.has(exportPath)) || !ownerIsRunning(pid)) {
            await fs.rm(exportPath, { recursive: true, force: true })
        }
    }
    const exportPath = await fs.mkdtemp(join(tempPath, `apple-mail-export-${process.pid}-`))
    activeExportDirectories.add(exportPath)
    return exportPath
}

export const removeAppleMailExportDirectory = async (exportPath: string): Promise<void> => {
    try {
        await fs.rm(exportPath, { recursive: true, force: true })
    } finally {
        activeExportDirectories.delete(exportPath)
    }
}
