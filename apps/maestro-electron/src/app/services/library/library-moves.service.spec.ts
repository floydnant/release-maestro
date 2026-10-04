import { newPrescanFactFixture } from '../../../test/fixtures/prescan-fact.fixture'
import {
    MetadataPrescanUpdate,
    MetadataScanUpdate,
    PrescanFileFact,
    SongMetadata,
} from '@release-maestro/core'
import { fromPartial } from '@total-typescript/shoehorn'
import { eq } from 'drizzle-orm'
import { copyFile, mkdtemp, rename, rm, writeFile, symlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'
import { firstValueFrom, from, Observable, toArray } from 'rxjs'
import { createMigratedTestDatabase } from '../../../test/fixtures/database.fixture'
import { newSongFixture } from '../../../test/fixtures/song-metadata.fixture'
import { songsTable } from '../../database/drizzle.schema'
import { MetadataBackendService } from '../metadata/metadata.backend.service'
import { LibraryBackendRepository } from './library.backend.repository'
import { LibraryBackendService } from './library.backend.service'

describe('move reconciliation across scan retries', () => {
    let directory: string
    let database: ReturnType<typeof createMigratedTestDatabase>
    let repository: LibraryBackendRepository
    let original: SongMetadata
    let found: SongMetadata
    const fact = (song: SongMetadata): PrescanFileFact => newPrescanFactFixture(song.path, { size: 8 })
    const rows = () => database.db.select().from(songsTable).all()
    const scanner = (
        outcome:
            | 'clean'
            | 'read error'
            | 'discovery error'
            | 'cancelled'
            | 'fatal'
            | 'cancel discovery'
            | 'read fails first',
        abort = new AbortController(),
        modifiedAt = 1_000,
        alsoSeen: SongMetadata[] = [],
        failedFact?: PrescanFileFact,
        unavailableFolders: string[] = [],
    ) =>
        new LibraryBackendService(
            repository,
            fromPartial<MetadataBackendService>({
                ping: async () => ({
                    protocolVersion: 1,
                    engineVersion: '0.1.0',
                    extractorVersion: 'test-extractor',
                }),
                prescan: () => {
                    if (outcome === 'cancel discovery') abort.abort()
                    return from<MetadataPrescanUpdate[]>([
                        {
                            phase: 'batch',
                            items: [
                                { ...fact(found), modifiedAt },
                                ...alsoSeen.map(fact),
                                ...(failedFact ? [failedFact] : []),
                            ],
                        },
                        ...(outcome === 'discovery error'
                            ? [{ phase: 'itemError' as const, path: '/locked', error: 'EACCES' }]
                            : []),
                        { phase: 'completed', count: 1, errors: outcome === 'discovery error' ? 1 : 0 },
                    ])
                },
                readFiles: () =>
                    new Observable<MetadataScanUpdate>(subscriber => {
                        if (outcome === 'read fails first') {
                            subscriber.next({ phase: 'itemError', path: found.path, error: 'read failed' })
                            subscriber.complete()
                            return
                        }
                        subscriber.next({ phase: 'item', metadata: found })
                        if (outcome === 'read error')
                            subscriber.next({
                                phase: 'itemError',
                                path: failedFact?.path ?? '/broken',
                                error: 'read failed',
                            })
                        if (outcome === 'cancelled') abort.abort()
                        if (outcome === 'fatal') subscriber.error(new Error('sidecar disconnected'))
                        else subscriber.complete()
                    }),
            }),
        )
            .scan([directory], abort.signal, false, unavailableFolders)
            .pipe(toArray())

    beforeEach(async () => {
        directory = await mkdtemp(join(tmpdir(), 'maestro-move-retry-'))
        database = createMigratedTestDatabase()
        repository = new LibraryBackendRepository(database.client)
        original = newSongFixture({ path: join(directory, 'original.mp3'), artist: 'Artist', duration: 120 })
        found = { ...original, path: join(directory, 'found.mp3'), fileName: 'found.mp3' }
        await writeFile(original.path, 'original')
        await copyFile(original.path, found.path)
        repository.processPrescanBatch([fact(original)], new Date(10_000), true)
        repository.ingestMetadata(original, fact(original), new Date(10_000), 'test-extractor')
    })
    afterEach(async () => {
        database.sqlite.close()
        await rm(directory, { recursive: true, force: true })
    })

    it('does not merge an original path that is a dangling symlink', async () => {
        const identity = rows()[0]
        await rm(original.path)
        await symlink(join(directory, 'absent-target'), original.path)
        await firstValueFrom(scanner('clean'))
        expect(rows()).toHaveLength(2)
        expect(rows().find(song => song.path == original.path)?.id).toBe(identity?.id)
    })

    it('does not absorb a backup while the configured original folder is unavailable', async () => {
        const identity = rows()[0]
        if (!identity) throw new Error('Expected original song')
        await rm(original.path)
        const offline = join(directory, 'offline')
        database.db
            .update(songsTable)
            .set({ path: join(offline, 'original.mp3') })
            .where(eq(songsTable.id, identity.id))
            .run()
        await firstValueFrom(scanner('clean', new AbortController(), 1_000, [], undefined, [offline]))
        expect(rows()).toHaveLength(2)
        expect(rows().find(song => song.id == identity.id)?.path).toBe(join(offline, 'original.mp3'))
    })

    it.each([
        'different size',
        'known different hash',
        'same size unknown',
        'same size same hash',
        'changed known hash',
    ] as const)('reconciles only when failed read evidence cannot hide a copy: %s', async evidence => {
        const identity = rows()[0]
        if (!identity) throw new Error('Expected original song')
        await rm(original.path)
        const broken = {
            ...original,
            path: join(directory, 'broken.mp3'),
            fileName: 'broken.mp3',
            contentHash: evidence == 'same size same hash' ? original.contentHash : 'b'.repeat(64),
        }
        const brokenFact = { ...fact(broken), size: evidence == 'different size' ? 9 : 8 }
        if (evidence != 'different size' && evidence != 'same size unknown') {
            repository.processPrescanBatch([brokenFact], new Date(10_001))
            repository.ingestMetadata(broken, brokenFact, new Date(10_001), 'older-extractor')
        }
        if (evidence == 'changed known hash') brokenFact.modifiedAt += 1
        await firstValueFrom(scanner('read error', new AbortController(), 1_000, [], brokenFact))
        const canMerge = evidence == 'different size' || evidence == 'known different hash'
        expect(rows()).toHaveLength(canMerge ? 2 : 3)
        expect(rows().find(song => song.id == identity.id)?.path).toBe(canMerge ? found.path : original.path)
        expect(rows().find(song => song.id == identity.id)?.addedAt).toEqual(identity.addedAt)
    })

    it.each([
        'read error',
        'discovery error',
        'cancelled',
        'fatal',
        'cancel discovery',
        'read fails first',
    ] as const)('retains proof of an excluded original despite %s', async outcome => {
        const result = firstValueFrom(scanner(outcome))
        if (outcome === 'fatal') await expect(result).rejects.toThrow('sidecar disconnected')
        else await result
        const copies = rows()
        expect(copies).toHaveLength(2)
        await rm(original.path)
        await firstValueFrom(scanner('clean'))
        expect(
            rows()
                .map(song => song.id)
                .sort(),
        ).toEqual(copies.map(song => song.id).sort())
        expect(rows().filter(song => song.present)).toHaveLength(1)
    })

    it.each([1_000, 2_000])('reports a repaired retry as changed, current mtime %s', async modifiedAt => {
        const identity = rows()[0]
        if (!identity) throw new Error('Expected original song')
        await rm(original.path)
        await firstValueFrom(scanner('read error'))
        expect(rows()).toHaveLength(2)
        const updates = await firstValueFrom(scanner('clean', new AbortController(), modifiedAt))
        expect(updates.at(-1)).toMatchObject({ phase: 'completed', new: 0, changed: 1, unchanged: 0 })
        expect(rows()).toEqual([
            expect.objectContaining({ id: identity.id, addedAt: identity.addedAt, path: found.path }),
        ])
    })

    it.each(['original', 'third'])(
        'preserves the original identity after a failed rename followed by a move to %s',
        async destination => {
            const identity = rows()[0]
            if (!identity) throw new Error('Expected original song')
            await rm(original.path)
            await firstValueFrom(scanner('read error'))
            expect(rows()).toHaveLength(2)
            const path = destination == 'original' ? original.path : join(directory, 'third.mp3')
            await rename(found.path, path)
            found = { ...found, path, fileName: basename(path) }
            const updates = await firstValueFrom(scanner('clean'))
            expect(updates.at(-1)).toMatchObject({ phase: 'completed', new: 0, changed: 1, unchanged: 0 })
            expect(rows()).toEqual([
                expect.objectContaining({ id: identity.id, addedAt: identity.addedAt, path }),
            ])
            await firstValueFrom(scanner('clean'))
            expect(rows()).toHaveLength(1)
            expect(rows()[0]?.id).toBe(identity.id)
        },
    )

    it('forgets a pending rename if both paths subsequently coexist outside the scan', async () => {
        await rm(original.path)
        await firstValueFrom(scanner('read error'))
        await copyFile(found.path, original.path)
        await firstValueFrom(scanner('read error'))
        const identities = rows()
            .map(song => song.id)
            .sort()
        await rm(original.path)
        await firstValueFrom(scanner('clean'))
        expect(
            rows()
                .map(song => song.id)
                .sort(),
        ).toEqual(identities)
    })

    it('keeps a returned original and an excluded destination as copies', async () => {
        await rm(original.path)
        await firstValueFrom(scanner('read error'))
        await copyFile(found.path, original.path)
        found = original
        await firstValueFrom(scanner('clean'))
        const identities = rows()
            .map(song => song.id)
            .sort()
        expect(identities).toHaveLength(2)
        await rm(join(directory, 'found.mp3'))
        await firstValueFrom(scanner('clean'))
        expect(
            rows()
                .map(song => song.id)
                .sort(),
        ).toEqual(identities)
    })

    it('retains the first identity across repeated failed renames and a new service instance', async () => {
        const identity = rows()[0]
        if (!identity) throw new Error('Expected original song')
        await rm(original.path)
        await firstValueFrom(scanner('read error'))
        for (const name of ['third.mp3', 'fourth.mp3']) {
            const path = join(directory, name)
            await rename(found.path, path)
            found = { ...found, path, fileName: name }
            await firstValueFrom(scanner('read error'))
        }
        expect(rows()).toHaveLength(4)
        repository = new LibraryBackendRepository(database.client)
        await firstValueFrom(scanner('clean'))
        expect(rows()).toEqual([
            expect.objectContaining({ id: identity.id, addedAt: identity.addedAt, path: found.path }),
        ])
    })

    it('discards rename evidence when discovery sees both paths', async () => {
        await rm(original.path)
        await firstValueFrom(scanner('read error'))
        await copyFile(found.path, original.path)
        await firstValueFrom(scanner('clean', new AbortController(), 1_000, [original]))
        const identities = rows()
            .map(song => song.id)
            .sort()
        expect(identities).toHaveLength(2)
        await rm(original.path)
        await firstValueFrom(scanner('clean'))
        expect(
            rows()
                .map(song => song.id)
                .sort(),
        ).toEqual(identities)
    })
})
