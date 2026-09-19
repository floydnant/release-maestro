import * as fs from 'fs/promises'
import { join } from 'path'

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
    for (const entry of await fs.readdir(tempPath, { withFileTypes: true })) {
        const owner = /^apple-mail-export-([1-9]\d*)-[a-zA-Z0-9]+$/.exec(entry.name)
        if (!entry.isDirectory() || !owner) continue
        const pid = Number(owner[1])
        if (!Number.isSafeInteger(pid) || pid > 2147483647) continue
        // Current-process directories can only belong to finished imports whose cleanup failed.
        if (pid === process.pid || !ownerIsRunning(pid)) {
            await fs.rm(join(tempPath, entry.name), { recursive: true, force: true })
        }
    }
    // Legacy unowned directories cannot be distinguished from exports in an older live app.
    return fs.mkdtemp(join(tempPath, `apple-mail-export-${process.pid}-`))
}
