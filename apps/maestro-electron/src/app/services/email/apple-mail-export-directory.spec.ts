import { spawn } from 'child_process'
import { once } from 'events'
import * as fs from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import { createAppleMailExportDirectory } from './apple-mail-export-directory'

describe('Apple Mail export directory ownership', () => {
    let tempPath: string

    beforeEach(async () => {
        tempPath = await fs.mkdtemp(join(tmpdir(), 'maestro-mail-ownership-test-'))
    })

    afterEach(async () => {
        await fs.rm(tempPath, { recursive: true, force: true })
    })

    it("preserves another process's active export and reclaims it after that process exits", async () => {
        const child = spawn(
            process.execPath,
            [
                '-e',
                `
            const fs = require('fs');
            const path = require('path');
            const directory = path.join(process.argv[1], 'apple-mail-export-' + process.pid + '-active');
            fs.mkdirSync(directory);
            fs.writeFileSync(path.join(directory, 'message.txt'), 'active export');
            process.stdout.write(directory + '\\n');
            setInterval(() => {}, 1000);
        `,
                tempPath,
            ],
            { env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' } },
        )
        const exited = once(child, 'close')
        try {
            const [output] = await once(child.stdout, 'data')
            const activePath = String(output).trim()
            const firstPath = await createAppleMailExportDirectory(tempPath)
            expect(firstPath).not.toBe(activePath)
            await expect(fs.readFile(join(activePath, 'message.txt'), 'utf8')).resolves.toBe('active export')
            child.kill()
            await exited
            await createAppleMailExportDirectory(tempPath)
            await expect(fs.stat(activePath)).rejects.toMatchObject({ code: 'ENOENT' })
        } finally {
            child.kill()
            await exited
        }
    })

    it("removes this process's abandoned files while preserving unowned and unrelated directories", async () => {
        const abandoned = join(tempPath, `apple-mail-export-${process.pid}-abandoned`)
        const legacy = join(tempPath, 'apple-mail-export')
        const unrelated = join(tempPath, 'other-export')
        const incomplete = join(tempPath, `apple-mail-export-${process.pid}-`)
        const invalidPid = join(tempPath, 'apple-mail-export-9999999999999999999999-abcdef')
        const preserved = [legacy, unrelated, incomplete, invalidPid]
        for (const directory of [abandoned, ...preserved]) {
            await fs.mkdir(directory)
            await fs.writeFile(join(directory, 'message.txt'), 'contents')
        }
        const exportPath = await createAppleMailExportDirectory(tempPath)
        await expect(fs.stat(abandoned)).rejects.toMatchObject({ code: 'ENOENT' })
        await expect(fs.readdir(exportPath)).resolves.toEqual([])
        for (const directory of preserved) {
            await expect(fs.readFile(join(directory, 'message.txt'), 'utf8')).resolves.toBe('contents')
        }
    })
})
