import { mkdtempSync, mkdirSync, symlinkSync, writeFileSync } from 'node:fs'
import { realpathSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { LibraryFoldersService } from './library-folders.service'

describe('LibraryFoldersService', () => {
    const service = new LibraryFoldersService()
    // realpath the base dir up front: on macOS /tmp is itself a symlink to /private/tmp.
    const base = realpathSync(mkdtempSync(join(tmpdir(), 'maestro-folders-')))
    const musicDir = join(base, 'music')
    const nestedDir = join(musicDir, 'albums')
    const otherDir = join(base, 'other')
    const linkToMusic = join(base, 'music-link')
    const filePath = join(base, 'not-a-folder.txt')

    beforeAll(() => {
        mkdirSync(nestedDir, { recursive: true })
        mkdirSync(otherDir)
        symlinkSync(musicDir, linkToMusic)
        writeFileSync(filePath, 'x')
    })

    it('canonicalizes symlinks so aliased selections collapse to one folder', async () => {
        const selection = await service.canonicalizeSelection([musicDir, linkToMusic, otherDir])
        expect(selection).toEqual([musicDir, otherDir])
    })

    it('preserves stable input ordering', async () => {
        const validations = await service.validate([otherDir, musicDir])
        expect(validations.map(validation => validation.path)).toEqual([otherDir, musicDir])
    })

    it('detects folders nested beneath another selected folder', async () => {
        const validations = await service.validate([musicDir, nestedDir, otherDir])
        expect(validations[0]).toMatchObject({ available: true })
        expect(validations[0]?.nestedUnder).toBeUndefined()
        expect(validations[1]).toMatchObject({ available: true, nestedUnder: musicDir })
        expect(validations[2]?.nestedUnder).toBeUndefined()
    })

    it('flags exactly one of an identical (canonical) duplicate pair', async () => {
        const validations = await service.validate([musicDir, linkToMusic])
        expect(validations[0]?.nestedUnder).toBeUndefined()
        expect(validations[1]).toMatchObject({ canonicalPath: musicDir, nestedUnder: musicDir })
    })

    it('reports missing folders as unavailable with a readable error', async () => {
        const missing = join(base, 'does-not-exist')
        const [validation] = await service.validate([missing])
        expect(validation).toMatchObject({ available: false, canonicalPath: missing })
        expect(validation?.error).toContain('not found')
    })

    it('reports plain files as unavailable', async () => {
        const [validation] = await service.validate([filePath])
        expect(validation).toMatchObject({ available: false, error: 'Not a folder' })
    })
})
