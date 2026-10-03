import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'

export const sha256 = bytes => createHash('sha256').update(bytes).digest('hex')

// The digest is committed with the version, rather than downloaded beside the executable.
export const verifyDownload = (bytes, digest) => {
    if (sha256(bytes) !== digest) throw new Error('Security tool checksum mismatch')
}

export const installTool = async (name, root) => {
    const manifest = JSON.parse(readFileSync(join(root, 'tools/security/tools.json'), 'utf8'))
    const tool = manifest[name]
    const platform = `${process.platform === 'win32' ? 'windows' : process.platform}-${process.arch === 'x64' ? 'amd64' : process.arch}`
    const asset = tool.platforms[platform]
    if (!asset) throw new Error(`Unsupported security tool platform: ${platform}`)
    const cache = join(root, '.cache/security-tools', name, tool.version)
    mkdirSync(cache, { recursive: true })
    const archive = join(cache, asset.asset)
    if (!existsSync(archive)) {
        const url = `https://github.com/${tool.repository}/releases/download/v${tool.version}/${asset.asset}`
        const response = await fetch(url, { signal: AbortSignal.timeout(120_000) })
        if (!response.ok) throw new Error(`Cannot download ${name}: HTTP ${response.status}`)
        const bytes = Buffer.from(await response.arrayBuffer())
        verifyDownload(bytes, asset.sha256)
        writeFileSync(archive, bytes)
    }
    verifyDownload(readFileSync(archive), asset.sha256)
    const executable = `${name}${process.platform === 'win32' ? '.exe' : ''}`
    if (name === 'osv-scanner') {
        chmodSync(archive, 0o755)
        return { path: archive, cleanup: () => {} }
    }
    // Extract the verified archive afresh so a cached, modified executable cannot run.
    const directory = mkdtempSync(join(tmpdir(), 'maestro-security-tool-'))
    try {
        execFileSync('tar', ['-xf', archive, '-C', directory, executable], { stdio: 'pipe' })
        const path = join(directory, basename(executable))
        chmodSync(path, 0o755)
        return { path, cleanup: () => rmSync(directory, { recursive: true, force: true }) }
    } catch (error) {
        rmSync(directory, { recursive: true, force: true })
        throw error
    }
}
