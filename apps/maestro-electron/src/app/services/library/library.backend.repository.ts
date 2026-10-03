import { PrescanFileFact, SongMetadata } from '@release-maestro/core'
import { randomUUID } from 'crypto'
import { and, asc, count, eq, gt, inArray, isNotNull, isNull, lt, max, min, ne, or, sql } from 'drizzle-orm'
import { DatabaseClient } from '../../database/database.client'
import {
    albumArtistsTable,
    albumsTable,
    artistRawNameArtistsTable,
    artistRawNamesTable,
    artistsTable,
    DbSong,
    genreRawNameGenresTable,
    genreRawNamesTable,
    genresTable,
    recordLabelsTable,
    NormalizationIssue,
    normalizationIssuesTable,
    songArtistsTable,
    songGenresTable,
    songsTable,
} from '../../database/drizzle.schema'
import {
    albumIdentityKey,
    detectNormalizationIssues,
    extractExternalRefs,
    fileFingerprint,
    filterExternalRefs,
    mergeExternalRefs,
    metadataHash,
    NORMALIZER_VERSION,
    normalizeDisplayText,
    yearFromMetadata,
    relevantExternalRefsMap,
    stableHash,
} from './library-normalization'

/**
 * Change-detection tallies for one prescan batch. The deep-read queue is NOT
 * derived from this — `listSongsNeedingMetadata` (pending metadata in the DB)
 * is the sole source, which also makes interrupted scans resumable.
 */
export interface PrescanBatchComparison {
    unchanged: number
    changed: number
    new: number
    changedPaths: string[]
}

export interface MovedSongCandidate {
    missing: DbSong
    found: DbSong
    intermediate?: DbSong[]
}

const titleFromFileName = (fileName: string): string => fileName.replace(/\.[^.]+$/, '').trim() || fileName
const NORMALIZATION_ISSUE_DETECTOR_VERSION = 1

const issueFingerprint = (issue: NormalizationIssue): string =>
    stableHash({
        field: issue.field,
        type: issue.type,
        value: issue.value ?? null,
    })

export class LibraryBackendRepository {
    constructor(private readonly database: Pick<DatabaseClient, 'db'>) {}

    private pendingMoveGroups(): DbSong[][] {
        const pending = this.database.db
            .select()
            .from(songsTable)
            .where(isNotNull(songsTable.moveOriginId))
            .all()
        const originIds = [
            ...new Set(pending.flatMap(song => (song.moveOriginId ? [song.moveOriginId] : []))),
        ]
        if (originIds.length == 0) return []
        const origins = this.database.db
            .select()
            .from(songsTable)
            .where(inArray(songsTable.id, originIds))
            .all()
        return origins.map(origin => [origin, ...pending.filter(song => song.moveOriginId == origin.id)])
    }

    invalidateCoexistingMoves(seenAt: Date): void {
        for (const group of this.pendingMoveGroups()) {
            if (group.filter(song => song.lastSeenAt.getTime() == seenAt.getTime()).length > 1) {
                this.database.db
                    .update(songsTable)
                    .set({ moveOriginId: null })
                    .where(
                        inArray(
                            songsTable.id,
                            group.map(song => song.id),
                        ),
                    )
                    .run()
            }
        }
    }

    recordPendingMove({ missing, found, intermediate = [] }: MovedSongCandidate): void {
        const ids = [found, ...intermediate].filter(song => song.id != missing.id).map(song => song.id)
        if (ids.length > 0)
            this.database.db
                .update(songsTable)
                .set({ moveOriginId: missing.id })
                .where(inArray(songsTable.id, ids))
                .run()
    }

    /** Positive availability evidence must not depend on a destination finishing its metadata read. */
    findAvailabilityProbes(seenAt: Date): { songId: string; originalPath: string; foundPath: string }[] {
        const seenSizes = this.database.db
            .select({ size: songsTable.size })
            .from(songsTable)
            .where(and(eq(songsTable.lastSeenAt, seenAt), isNotNull(songsTable.firstSeenAt)))
        const originals = this.database.db
            .select({
                id: songsTable.id,
                path: songsTable.path,
                size: songsTable.size,
                lastAvailableAt: songsTable.lastAvailableAt,
            })
            .from(songsTable)
            .where(and(lt(songsTable.lastSeenAt, seenAt), inArray(songsTable.size, seenSizes)))
            .all()
        const probes = originals.flatMap(original => {
            const found = this.database.db
                .select({ path: songsTable.path })
                .from(songsTable)
                .where(
                    and(
                        eq(songsTable.lastSeenAt, seenAt),
                        eq(songsTable.size, original.size),
                        gt(songsTable.firstSeenAt, original.lastAvailableAt),
                    ),
                )
                .all()
            // Prefer a possible case alias: its old spelling is not a separate original.
            const destination =
                found.find(song => song.path.toLowerCase() == original.path.toLowerCase()) ?? found[0]
            return destination
                ? [{ songId: original.id, originalPath: original.path, foundPath: destination.path }]
                : []
        })
        // Returning to an earlier path reverses the discovery chronology. Pending rename
        // evidence still needs a coexistence check, including when a metadata read fails.
        for (const group of this.pendingMoveGroups()) {
            const found = group.find(song => song.lastSeenAt.getTime() == seenAt.getTime())
            if (!found) continue
            for (const original of group.filter(song => song.lastSeenAt < seenAt)) {
                if (!probes.some(probe => probe.songId == original.id)) {
                    probes.push({ songId: original.id, originalPath: original.path, foundPath: found.path })
                }
            }
        }
        return probes
    }

    /** Match only complete, unambiguous pairs after every discovery/deep-read batch. */
    findMovedSongCandidates(seenAt: Date): MovedSongCandidate[] {
        const candidates = new Map<string, MovedSongCandidate>()
        const contentGroups = this.database.db
            .select({ hash: songsTable.contentHash, size: songsTable.size })
            .from(songsTable)
            .where(isNotNull(songsTable.contentHash))
            .groupBy(songsTable.contentHash, songsTable.size)
            .having(
                and(
                    gt(count(), 1),
                    sql`sum(case when ${songsTable.lastSeenAt} = ${seenAt.getTime()} then 1 else 0 end) = 1`,
                ),
            )
            .all()
        const consider = (pair: DbSong[], legacy: boolean) => {
            if (
                pair.length < 2 ||
                pair.filter(song => song.lastSeenAt.getTime() == seenAt.getTime()).length != 1
            )
                return
            const found = pair.find(song => song.lastSeenAt.getTime() == seenAt.getTime())
            if (!found) return
            const origins = new Set(pair.map(song => song.moveOriginId ?? song.id))
            let originId: string | undefined
            if (origins.size == 1) {
                originId = found.moveOriginId ?? found.id
            } else if (
                origins.size == 2 &&
                !found.moveOriginId &&
                !pair.some(song => song.moveOriginId == found.id)
            ) {
                originId = [...origins].find(id => id != found.id)
                const firstSeenAt = found.firstSeenAt
                if (
                    !firstSeenAt ||
                    pair.some(song => song.id != found.id && firstSeenAt <= song.lastAvailableAt)
                )
                    return
            } else return
            const missing = pair.find(song => song.id == originId)
            if (!missing) return
            // A failed read may leave a hash for an older version of this path.
            if (pair.some(song => song.scannedFileFingerprint != song.fileFingerprint)) return
            if (!found.contentHash || !found.present) return
            if (
                legacy &&
                (missing.contentHash ||
                    !missing.rawTitle?.trim() ||
                    missing.rawTitle == missing.fileName ||
                    !(missing.rawArtist?.trim() || missing.rawAlbumTitle?.trim()) ||
                    !missing.duration)
            )
                return
            if (!candidates.has(found.id))
                candidates.set(found.id, {
                    missing,
                    found,
                    intermediate: pair.filter(song => song.id != missing.id && song.id != found.id),
                })
        }
        for (const group of contentGroups) {
            if (!group.hash) continue
            consider(
                this.database.db
                    .select()
                    .from(songsTable)
                    .where(and(eq(songsTable.contentHash, group.hash), eq(songsTable.size, group.size)))
                    .all(),
                false,
            )
        }
        // Older missing rows have no byte hash. Group their persisted tags and audio properties,
        // excluding artwork paths and user-editable references. Only inspect sizes needing this fallback.
        const legacySizes = this.database.db
            .select({ size: songsTable.size })
            .from(songsTable)
            .where(and(isNull(songsTable.contentHash), lt(songsTable.lastSeenAt, seenAt)))
        const legacyGroups = new Map<string, DbSong[]>()
        for (const song of this.database.db
            .select()
            .from(songsTable)
            .where(inArray(songsTable.size, legacySizes))
            .all()) {
            const key = legacyMoveKey(song)
            const group = legacyGroups.get(key) ?? []
            group.push(song)
            legacyGroups.set(key, group)
        }
        for (const pair of legacyGroups.values()) consider(pair, true)
        return [...candidates.values()]
    }

    /** Keep the original identity and user state, replace its location and latest derived data atomically. */
    reconcileMovedSong({ missing, found, intermediate = [] }: MovedSongCandidate): void {
        this.database.db.transaction(tx => {
            const sources = [
                ...new Map([missing, ...intermediate, found].map(song => [song.id, song])).values(),
            ]
            const sourceIds = sources.map(song => song.id)
            const issues = tx
                .select()
                .from(normalizationIssuesTable)
                .where(
                    and(
                        eq(normalizationIssuesTable.entityType, 'SONG'),
                        inArray(normalizationIssuesTable.entityId, sourceIds),
                    ),
                )
                .all()
            for (const fingerprint of new Set(issues.map(issue => issue.fingerprint))) {
                const group = issues.filter(issue => issue.fingerprint == fingerprint)
                const original = group.find(issue => issue.entityId == missing.id)
                const current = group.find(issue => issue.entityId == found.id)
                const retained = original ?? current ?? group[0]
                if (!retained) continue
                const dismissed = group.find(issue => issue.status == 'DISMISSED')
                for (const issue of group.filter(issue => issue.id != retained.id)) {
                    tx.delete(normalizationIssuesTable).where(eq(normalizationIssuesTable.id, issue.id)).run()
                }
                tx.update(normalizationIssuesTable)
                    .set({
                        entityId: missing.id,
                        lastSeenAt: current?.lastSeenAt ?? retained.lastSeenAt,
                        detectorVersion: current?.detectorVersion ?? retained.detectorVersion,
                        status: dismissed
                            ? 'DISMISSED'
                            : (current?.status ??
                              (retained.status == 'OPEN' ? 'DISAPPEARED' : retained.status)),
                        closedAt: dismissed
                            ? dismissed.closedAt
                            : current
                              ? current.closedAt
                              : retained.status == 'OPEN'
                                ? found.lastScannedAt
                                : retained.closedAt,
                    })
                    .where(eq(normalizationIssuesTable.id, retained.id))
                    .run()
            }
            if (found.id != missing.id) {
                tx.delete(songArtistsTable).where(eq(songArtistsTable.songId, missing.id)).run()
                tx.update(songArtistsTable)
                    .set({ songId: missing.id })
                    .where(eq(songArtistsTable.songId, found.id))
                    .run()
                tx.delete(songGenresTable).where(eq(songGenresTable.songId, missing.id)).run()
                tx.update(songGenresTable)
                    .set({ songId: missing.id })
                    .where(eq(songGenresTable.songId, found.id))
                    .run()
            }
            tx.delete(songsTable)
                .where(
                    inArray(
                        songsTable.id,
                        sourceIds.filter(id => id != missing.id),
                    ),
                )
                .run()
            tx.update(songsTable)
                .set({
                    ...found,
                    id: missing.id,
                    addedAt: missing.addedAt,
                    firstSeenAt: missing.firstSeenAt,
                    moveOriginId: null,
                    externalRefs: mergeExternalRefs(sources.map(song => song.externalRefs)),
                })
                .where(eq(songsTable.id, missing.id))
                .run()
            reconcileAlbumMembers(
                tx,
                sources.map(song => song.albumId),
            )
        })
    }

    recordSongAvailable(id: string, availableAt: Date): void {
        const song = this.database.db.select().from(songsTable).where(eq(songsTable.id, id)).get()
        if (song)
            this.database.db
                .update(songsTable)
                .set({ moveOriginId: null })
                .where(eq(songsTable.moveOriginId, song.moveOriginId ?? song.id))
                .run()

        this.database.db
            .update(songsTable)
            .set({ lastAvailableAt: availableAt })
            .where(eq(songsTable.id, id))
            .run()
    }

    countOpenIssuesForReadSongs(seenAt: Date): number {
        return (
            this.database.db
                .select({ value: sql<number>`count(distinct ${songsTable.id})` })
                .from(songsTable)
                .innerJoin(
                    normalizationIssuesTable,
                    and(
                        eq(normalizationIssuesTable.entityType, 'SONG'),
                        eq(normalizationIssuesTable.entityId, songsTable.id),
                    ),
                )
                .where(
                    and(
                        eq(songsTable.lastSeenAt, seenAt),
                        sql`${songsTable.lastScannedAt} >= ${seenAt.getTime()}`,
                        eq(normalizationIssuesTable.status, 'OPEN'),
                    ),
                )
                .get()?.value ?? 0
        )
    }

    nextScanSeenAt(): Date {
        const latest = this.database.db
            .select({ value: max(songsTable.lastSeenAt) })
            .from(songsTable)
            .get()?.value
        return new Date(Math.max(Date.now(), (latest?.getTime() ?? 0) + 1))
    }

    processPrescanBatch(facts: PrescanFileFact[], seenAt: Date, initialScan = false): PrescanBatchComparison {
        if (facts.length == 0) {
            return { unchanged: 0, changed: 0, new: 0, changedPaths: [] }
        }

        const existingSongs = this.database.db
            .select()
            .from(songsTable)
            .where(
                inArray(
                    songsTable.path,
                    facts.map(fact => fact.path),
                ),
            )
            .all()
        const existingByPath = new Map<string, DbSong>()
        for (const song of existingSongs) {
            existingByPath.set(song.path, song)
        }
        const comparison: PrescanBatchComparison = {
            unchanged: 0,
            changed: 0,
            new: 0,
            changedPaths: [],
        }

        this.database.db.transaction(tx => {
            for (const fact of facts) {
                const fingerprint = fileFingerprint(fact)
                const existing = existingByPath.get(fact.path)
                const fileValues = {
                    fileName: fact.fileName,
                    size: fact.size,
                    modifiedAt: new Date(fact.modifiedAt),
                    createdAt: fact.createdAt ? new Date(fact.createdAt) : null,
                    fileFingerprint: fingerprint,
                    present: true,
                    lastSeenAt: seenAt,
                    lastAvailableAt: seenAt,
                }

                if (!existing) {
                    tx.insert(songsTable)
                        .values({
                            id: randomUUID(),
                            path: fact.path,
                            ...fileValues,
                            firstSeenAt: seenAt,
                            addedAt: initialScan ? (fileValues.createdAt ?? seenAt) : seenAt,
                            title: titleFromFileName(fact.fileName),
                        })
                        .run()
                    comparison.new += 1
                    continue
                }

                tx.update(songsTable).set(fileValues).where(eq(songsTable.id, existing.id)).run()

                if (existing.fileFingerprint == fingerprint) {
                    comparison.unchanged += 1
                } else {
                    comparison.changed += 1
                    comparison.changedPaths.push(fact.path)
                }
            }
        })

        return comparison
    }

    markNotSeenPresent(scanStartedAt: Date): number {
        return this.database.db
            .update(songsTable)
            .set({ present: false })
            .where(and(eq(songsTable.present, true), lt(songsTable.lastSeenAt, scanStartedAt)))
            .run().changes
    }

    /** Use the song path index to check covers without repeatedly sorting the whole library. */
    listSeenSongCovers(seenAt: Date, afterPath: string | null, limit: number) {
        return this.database.db
            .select({ path: songsTable.path, coverPath: songsTable.coverPath })
            .from(songsTable)
            .where(
                and(
                    eq(songsTable.lastSeenAt, seenAt),
                    isNotNull(songsTable.coverPath),
                    afterPath === null ? undefined : gt(songsTable.path, afterPath),
                ),
            )
            .orderBy(asc(songsTable.path))
            .limit(limit)
            .all()
            .flatMap(song =>
                song.coverPath === null ? [] : [{ path: song.path, coverPath: song.coverPath }],
            )
    }

    queueSongsWithMissingCovers(seenAt: Date, songPaths: string[]): void {
        if (songPaths.length === 0) return
        // Persist pending reads so cancellation or a read failure retries on the next scan.
        this.database.db
            .update(songsTable)
            .set({ scannedFileFingerprint: null })
            .where(and(eq(songsTable.lastSeenAt, seenAt), inArray(songsTable.path, songPaths)))
            .run()
    }

    listSongsNeedingMetadata(
        seenAt: Date,
        afterPath: string | null,
        limit: number,
        extractorVersion: string,
    ): PrescanFileFact[] {
        const pendingCondition = songsNeedingMetadata(extractorVersion)
        const where = afterPath
            ? and(
                  eq(songsTable.lastSeenAt, seenAt),
                  eq(songsTable.present, true),
                  pendingCondition,
                  gt(songsTable.path, afterPath),
              )
            : and(eq(songsTable.lastSeenAt, seenAt), eq(songsTable.present, true), pendingCondition)

        return this.database.db
            .select({
                path: songsTable.path,
                fileName: songsTable.fileName,
                size: songsTable.size,
                modifiedAt: songsTable.modifiedAt,
                createdAt: songsTable.createdAt,
            })
            .from(songsTable)
            .where(where)
            .orderBy(asc(songsTable.path))
            .limit(limit)
            .all()
            .map(song => ({
                path: song.path,
                fileName: song.fileName,
                size: song.size,
                modifiedAt: song.modifiedAt.getTime(),
                ...(song.createdAt ? { createdAt: song.createdAt.getTime() } : {}),
            }))
    }

    countSongsNeedingMetadata(seenAt: Date, extractorVersion: string): number {
        return (
            this.database.db
                .select({ count: count(songsTable.id) })
                .from(songsTable)
                .where(
                    and(
                        eq(songsTable.lastSeenAt, seenAt),
                        eq(songsTable.present, true),
                        songsNeedingMetadata(extractorVersion),
                    ),
                )
                .get()?.count ?? 0
        )
    }

    countSongsNeedingVersionRefresh(seenAt: Date, extractorVersion: string): number {
        return (
            this.database.db
                .select({ count: count(songsTable.id) })
                .from(songsTable)
                .where(
                    and(
                        eq(songsTable.lastSeenAt, seenAt),
                        eq(songsTable.present, true),
                        eq(songsTable.scannedFileFingerprint, songsTable.fileFingerprint),
                        metadataRevisionMismatch(extractorVersion),
                    ),
                )
                .get()?.count ?? 0
        )
    }

    /** @returns the number of normalization issues left OPEN on the song after ingest. */
    ingestMetadata(
        metadata: SongMetadata,
        fact: PrescanFileFact,
        scannedAt: Date,
        extractorVersion: string,
    ): number {
        const db = this.database.db
        const rawArtist = metadata.artist
        const rawAlbumArtist = metadata.albumArtist
        const rawGenre = metadata.genre
        const artistText = normalizeDisplayText(rawArtist)
        const albumArtistText = normalizeDisplayText(rawAlbumArtist)
        const albumTitle = normalizeDisplayText(metadata.albumTitle)
        const genreText = normalizeDisplayText(metadata.genre)
        const recordLabelText = normalizeDisplayText(metadata.label)
        // Almost no MP3 fills the dedicated year field — see `yearFromMetadata`.
        const year = yearFromMetadata(metadata)
        const externalRefs = extractExternalRefs(metadata.extraMetadata, metadata.comment)

        return db.transaction(tx => {
            const getOrCreateArtist = (name: string): string => {
                const existing = tx
                    .select({ id: artistsTable.id })
                    .from(artistsTable)
                    .where(eq(artistsTable.name, name))
                    .get()
                if (existing) return existing.id

                const id = randomUUID()
                tx.insert(artistsTable)
                    .values({
                        id,
                        name,
                    })
                    .onConflictDoNothing()
                    .run()
                return (
                    tx
                        .select({ id: artistsTable.id })
                        .from(artistsTable)
                        .where(eq(artistsTable.name, name))
                        .get()?.id ?? id
                )
            }

            const resolveArtists = (rawText: string | null, displayText: string | null): string[] => {
                if (!rawText || !displayText) return []

                const now = scannedAt
                const existingRawName = tx
                    .select()
                    .from(artistRawNamesTable)
                    .where(eq(artistRawNamesTable.rawText, rawText))
                    .get()
                const rawNameId = existingRawName?.id ?? randomUUID()

                if (existingRawName) {
                    tx.update(artistRawNamesTable)
                        .set({ normalizedText: displayText, lastSeenAt: now })
                        .where(eq(artistRawNamesTable.id, rawNameId))
                        .run()
                } else {
                    tx.insert(artistRawNamesTable)
                        .values({
                            id: rawNameId,
                            rawText,
                            normalizedText: displayText,
                            firstSeenAt: now,
                            lastSeenAt: now,
                            createdAt: now,
                            updatedAt: now,
                        })
                        .run()
                }

                if (existingRawName?.confirmedByUser) {
                    const resolvedArtists = tx
                        .select({ artistId: artistRawNameArtistsTable.artistId })
                        .from(artistRawNameArtistsTable)
                        .where(eq(artistRawNameArtistsTable.artistRawNameId, rawNameId))
                        .orderBy(asc(artistRawNameArtistsTable.position))
                        .all()
                        .map(row => row.artistId)
                    if (resolvedArtists.length > 0) return resolvedArtists
                }

                const artistId = getOrCreateArtist(displayText)
                tx.delete(artistRawNameArtistsTable)
                    .where(eq(artistRawNameArtistsTable.artistRawNameId, rawNameId))
                    .run()
                tx.insert(artistRawNameArtistsTable)
                    .values({ artistRawNameId: rawNameId, artistId, position: 0 })
                    .run()
                return [artistId]
            }

            const getOrCreateRecordLabel = (name: string | null): string | null => {
                if (!name) return null
                const existingLabel = tx
                    .select({ id: recordLabelsTable.id, externalRefs: recordLabelsTable.externalRefs })
                    .from(recordLabelsTable)
                    .where(eq(recordLabelsTable.name, name))
                    .get()
                if (existingLabel) {
                    tx.update(recordLabelsTable)
                        .set({
                            externalRefs: mergeExternalRefs([
                                existingLabel.externalRefs,
                                filterExternalRefs(externalRefs, relevantExternalRefsMap.recordLabels),
                            ]),
                        })
                        .where(eq(recordLabelsTable.id, existingLabel.id))
                        .run()

                    return existingLabel.id
                }

                const id = randomUUID()
                tx.insert(recordLabelsTable)
                    .values({
                        id,
                        name,
                        externalRefs: filterExternalRefs(externalRefs, relevantExternalRefsMap.recordLabels),
                    })
                    .onConflictDoNothing()
                    .run()
                return (
                    tx
                        .select({ id: recordLabelsTable.id })
                        .from(recordLabelsTable)
                        .where(eq(recordLabelsTable.name, name))
                        .get()?.id ?? id
                )
            }

            const getOrCreateGenre = (name: string): string => {
                const existingGenre = tx
                    .select({ id: genresTable.id })
                    .from(genresTable)
                    .where(eq(genresTable.name, name))
                    .get()
                if (existingGenre) return existingGenre.id

                const id = randomUUID()
                tx.insert(genresTable).values({ id, name }).onConflictDoNothing().run()
                return (
                    tx
                        .select({ id: genresTable.id })
                        .from(genresTable)
                        .where(eq(genresTable.name, name))
                        .get()?.id ?? id
                )
            }

            const resolveGenres = (rawText: string | null, displayText: string | null): string[] => {
                if (!rawText || !displayText) return []

                const now = scannedAt
                const existingRawName = tx
                    .select()
                    .from(genreRawNamesTable)
                    .where(eq(genreRawNamesTable.rawText, rawText))
                    .get()
                const rawNameId = existingRawName?.id ?? randomUUID()

                if (existingRawName) {
                    tx.update(genreRawNamesTable)
                        .set({ normalizedText: displayText, lastSeenAt: now })
                        .where(eq(genreRawNamesTable.id, rawNameId))
                        .run()
                } else {
                    tx.insert(genreRawNamesTable)
                        .values({
                            id: rawNameId,
                            rawText,
                            normalizedText: displayText,
                            firstSeenAt: now,
                            lastSeenAt: now,
                            createdAt: now,
                            updatedAt: now,
                        })
                        .run()
                }

                if (existingRawName?.confirmedByUser) {
                    const resolvedGenres = tx
                        .select({ genreId: genreRawNameGenresTable.genreId })
                        .from(genreRawNameGenresTable)
                        .where(eq(genreRawNameGenresTable.genreRawNameId, rawNameId))
                        .orderBy(asc(genreRawNameGenresTable.position))
                        .all()
                        .map(row => row.genreId)
                    if (resolvedGenres.length > 0) return resolvedGenres
                }

                const genreId = getOrCreateGenre(displayText)
                tx.delete(genreRawNameGenresTable)
                    .where(eq(genreRawNameGenresTable.genreRawNameId, rawNameId))
                    .run()
                tx.insert(genreRawNameGenresTable)
                    .values({ genreRawNameId: rawNameId, genreId, position: 0 })
                    .run()
                return [genreId]
            }

            const songArtists = resolveArtists(rawArtist, artistText)
            const albumArtists = resolveArtists(rawAlbumArtist, albumArtistText)
            const songGenres = resolveGenres(rawGenre, genreText)
            const recordLabelId = getOrCreateRecordLabel(recordLabelText)
            let albumId: string | null = null

            if (albumTitle) {
                const identityKey = albumIdentityKey(metadata)
                const existingAlbum = tx
                    .select({ id: albumsTable.id, externalRefs: albumsTable.externalRefs })
                    .from(albumsTable)
                    .where(eq(albumsTable.identityKey, identityKey))
                    .get()
                albumId = existingAlbum?.id ?? randomUUID()
                const albumValues = {
                    identityKey,
                    title: albumTitle,
                    artistText: albumArtistText,
                    year,
                    date: normalizeDisplayText(metadata.date),
                    catalogNumber: normalizeDisplayText(metadata.catalogNumber),
                    // Cover art is recomputed from every member after the song upsert.
                    externalRefs: mergeExternalRefs([
                        existingAlbum?.externalRefs,
                        filterExternalRefs(externalRefs, relevantExternalRefsMap.albums),
                    ]),
                    recordLabelId,
                    recordLabelText,
                    // `dateAdded` is set below, once the song this album is being
                    // written for is itself in the table for the `MAX` to see.
                } satisfies Omit<typeof albumsTable.$inferInsert, 'id' | 'dateAdded'>

                if (existingAlbum) {
                    tx.update(albumsTable).set(albumValues).where(eq(albumsTable.id, albumId)).run()
                } else {
                    tx.insert(albumsTable)
                        .values({ id: albumId, ...albumValues })
                        .run()
                }

                tx.delete(albumArtistsTable).where(eq(albumArtistsTable.albumId, albumId)).run()
                if (albumArtists.length > 0) {
                    const resolvedAlbumId = albumId
                    tx.insert(albumArtistsTable)
                        .values(
                            albumArtists.map((artistId, position) => ({
                                albumId: resolvedAlbumId,
                                artistId,
                                role: 'primary',
                                position,
                            })),
                        )
                        .run()
                }
            }

            const existingSong = tx
                .select({
                    id: songsTable.id,
                    lastSeenAt: songsTable.lastSeenAt,
                    albumId: songsTable.albumId,
                })
                .from(songsTable)
                .where(eq(songsTable.path, metadata.path))
                .get()
            const songId = existingSong?.id ?? randomUUID()
            const songValues = {
                path: metadata.path,
                fileName: metadata.fileName,
                size: fact.size,
                modifiedAt: new Date(fact.modifiedAt),
                createdAt: fact.createdAt ? new Date(fact.createdAt) : null,
                fileFingerprint: fileFingerprint(fact),
                scannedFileFingerprint: fileFingerprint(fact),
                present: true,
                lastSeenAt: existingSong?.lastSeenAt ?? scannedAt,
                lastScannedAt: scannedAt,
                rawTitle: metadata.title,
                rawArtist,
                rawAlbumTitle: metadata.albumTitle,
                rawAlbumArtist,
                rawGenre: metadata.genre,
                rawRecordLabel: metadata.label,
                title: normalizeDisplayText(metadata.title) ?? titleFromFileName(metadata.fileName),
                artistText,
                albumTitle,
                albumArtistText,
                genreText,
                recordLabelText,
                catalogNumber: normalizeDisplayText(metadata.catalogNumber),
                year,
                trackNumber: metadata.track,
                discNumber: metadata.discNumber,
                discTotal: metadata.discTotal,
                trackTotal: metadata.trackTotal,
                comment: normalizeDisplayText(metadata.comment),
                musicalKey: normalizeDisplayText(metadata.musicalKey),
                bpm: metadata.bpm,
                energy: normalizeDisplayText(metadata.energy),
                lyrics: metadata.lyrics,
                date: normalizeDisplayText(metadata.date),
                coverPath: metadata.coverPath,
                duration: metadata.duration ?? metadata.fileInfo?.duration ?? null,
                overallBitrate: metadata.fileInfo?.overallBitrate ?? null,
                audioBitrate: metadata.fileInfo?.audioBitrate ?? null,
                sampleRate: metadata.fileInfo?.sampleRate ?? null,
                bitDepth: metadata.fileInfo?.bitDepth ?? null,
                channels: metadata.fileInfo?.channels ?? null,
                tagType: metadata.fileInfo?.tagType ?? null,
                codec: metadata.fileInfo?.codec ?? null,
                metadataHash: metadataHash(metadata),
                contentHash: metadata.contentHash,
                normalizerVersion: NORMALIZER_VERSION,
                extractorVersion,
                externalRefs,
                albumId,
            } satisfies Omit<typeof songsTable.$inferInsert, 'id'>

            if (existingSong) {
                tx.update(songsTable).set(songValues).where(eq(songsTable.id, songId)).run()
            } else {
                tx.insert(songsTable)
                    .values({ id: songId, ...songValues, addedAt: scannedAt })
                    .run()
            }

            reconcileAlbumMembers(tx, [existingSong?.albumId, albumId])

            tx.delete(songArtistsTable).where(eq(songArtistsTable.songId, songId)).run()
            if (songArtists.length > 0) {
                tx.insert(songArtistsTable)
                    .values(
                        songArtists.map((artistId, position) => ({
                            songId,
                            artistId,
                            role: 'primary',
                            position,
                        })),
                    )
                    .run()
            }

            tx.delete(songGenresTable).where(eq(songGenresTable.songId, songId)).run()
            if (songGenres.length > 0) {
                tx.insert(songGenresTable)
                    .values(songGenres.map(genreId => ({ songId, genreId })))
                    .run()
            }

            const detectedIssues = detectNormalizationIssues(metadata)
            const currentFingerprints = new Set(detectedIssues.map(issue => issueFingerprint(issue)))
            const existingIssues = tx
                .select()
                .from(normalizationIssuesTable)
                .where(
                    and(
                        eq(normalizationIssuesTable.entityType, 'SONG'),
                        eq(normalizationIssuesTable.entityId, songId),
                    ),
                )
                .all()
            const existingIssuesByFingerprint = new Map(
                existingIssues.map(issue => [issue.fingerprint, issue]),
            )

            let openIssues = 0
            for (const issue of detectedIssues) {
                const fingerprint = issueFingerprint(issue)
                const existingIssue = existingIssuesByFingerprint.get(fingerprint)
                if (!existingIssue || existingIssue.status != 'DISMISSED') openIssues += 1
                if (existingIssue) {
                    tx.update(normalizationIssuesTable)
                        .set({
                            issueType: issue.type,
                            field: issue.field,
                            value: issue.value,
                            lastSeenAt: scannedAt,
                            status: existingIssue.status == 'DISMISSED' ? 'DISMISSED' : 'OPEN',
                            closedAt: existingIssue.status == 'DISMISSED' ? existingIssue.closedAt : null,
                            detectorVersion: NORMALIZATION_ISSUE_DETECTOR_VERSION,
                        })
                        .where(eq(normalizationIssuesTable.id, existingIssue.id))
                        .run()
                    continue
                }

                tx.insert(normalizationIssuesTable)
                    .values({
                        id: randomUUID(),
                        entityType: 'SONG',
                        entityId: songId,
                        issueType: issue.type,
                        field: issue.field,
                        value: issue.value,
                        fingerprint,
                        status: 'OPEN',
                        firstSeenAt: scannedAt,
                        lastSeenAt: scannedAt,
                        detectorVersion: NORMALIZATION_ISSUE_DETECTOR_VERSION,
                    })
                    .run()
            }

            for (const existingIssue of existingIssues) {
                if (
                    currentFingerprints.has(existingIssue.fingerprint) ||
                    existingIssue.status == 'DISMISSED' ||
                    existingIssue.status == 'RESOLVED'
                ) {
                    continue
                }

                tx.update(normalizationIssuesTable)
                    .set({
                        status: 'DISAPPEARED',
                        closedAt: scannedAt,
                    })
                    .where(eq(normalizationIssuesTable.id, existingIssue.id))
                    .run()
            }

            return openIssues
        })
    }

    removeUnusedCatalogEntities(): void {
        this.database.db.transaction(tx => {
            // A re-read can move the last song off an album. Drop empty albums first
            // so their artist and record label links do not keep obsolete entities alive.
            tx.run(sql`DELETE FROM albums WHERE NOT EXISTS (
                SELECT 1 FROM songs WHERE songs.album_id = albums.id
            )`)
            // Keep user-confirmed resolutions even if the tag no longer appears.
            tx.run(sql`DELETE FROM artist_raw_names WHERE confirmed_by_user = 0 AND raw_text NOT IN (
                SELECT raw_artist FROM songs WHERE raw_artist IS NOT NULL
                UNION SELECT raw_album_artist FROM songs WHERE raw_album_artist IS NOT NULL
            )`)
            tx.run(sql`DELETE FROM genre_raw_names WHERE confirmed_by_user = 0 AND raw_text NOT IN (
                SELECT raw_genre FROM songs WHERE raw_genre IS NOT NULL
            )`)
            tx.run(sql`DELETE FROM artists WHERE NOT EXISTS (
                SELECT 1 FROM song_artists WHERE song_artists.artist_id = artists.id
            ) AND NOT EXISTS (
                SELECT 1 FROM album_artists WHERE album_artists.artist_id = artists.id
            ) AND NOT EXISTS (
                SELECT 1 FROM artist_raw_name_artists WHERE artist_raw_name_artists.artist_id = artists.id
            )`)
            tx.run(sql`DELETE FROM genres WHERE NOT EXISTS (
                SELECT 1 FROM song_genres WHERE song_genres.genre_id = genres.id
            ) AND NOT EXISTS (
                SELECT 1 FROM genre_raw_name_genres WHERE genre_raw_name_genres.genre_id = genres.id
            )`)
            tx.run(sql`DELETE FROM record_labels WHERE NOT EXISTS (
                SELECT 1 FROM albums WHERE albums.record_label_id = record_labels.id
            ) AND NOT EXISTS (
                SELECT 1 FROM songs WHERE songs.record_label_text = record_labels.name
            )`)
        })
    }
}

/**
 * Which songs still owe the metadata pass.
 *
 * Shared by the count and the listing on purpose — they answer the same question, and
 * when they were written out separately a condition added to one silently did not
 * reach the other.
 *
 * A file qualifies when it has never been read, when a missing cover queued it again,
 * when the file itself changed, or when it was last read by an older revision of the
 * normalizer or Rust extractor. Those clauses let changed rules reach rows already in the database: nothing
 * happens on disk, so the fingerprint alone would skip them forever.
 */
const songsNeedingMetadata = (extractorVersion: string) =>
    or(
        isNull(songsTable.contentHash),
        isNull(songsTable.scannedFileFingerprint),
        ne(songsTable.scannedFileFingerprint, songsTable.fileFingerprint),
        metadataRevisionMismatch(extractorVersion),
    )

/** Both the read queue and its refresh subtotal use the same revision rule. */
const metadataRevisionMismatch = (extractorVersion: string) =>
    or(
        isNull(songsTable.normalizerVersion),
        ne(songsTable.normalizerVersion, NORMALIZER_VERSION),
        isNull(songsTable.extractorVersion),
        ne(songsTable.extractorVersion, extractorVersion),
    )

/** Legacy identity uses persisted tag values; file and artwork locations are deliberately absent. */
const legacyMoveKey = (song: DbSong): string =>
    stableHash({
        size: song.size,
        title: normalizeDisplayText(song.rawTitle),
        artist: normalizeDisplayText(song.rawArtist),
        album: normalizeDisplayText(song.rawAlbumTitle),
        albumArtist: normalizeDisplayText(song.rawAlbumArtist),
        genre: normalizeDisplayText(song.rawGenre),
        label: normalizeDisplayText(song.rawRecordLabel),
        catalogNumber: song.catalogNumber,
        year: song.year,
        track: song.trackNumber,
        discNumber: song.discNumber,
        discTotal: song.discTotal,
        trackTotal: song.trackTotal,
        comment: song.comment,
        musicalKey: song.musicalKey,
        bpm: song.bpm,
        energy: song.energy,
        lyrics: song.lyrics,
        date: song.date,
        duration: song.duration,
        overallBitrate: song.overallBitrate,
        audioBitrate: song.audioBitrate,
        sampleRate: song.sampleRate,
        bitDepth: song.bitDepth,
        channels: song.channels,
        tagType: song.tagType,
        codec: song.codec,
    })

/** Missing songs remain members. Cover selection must not depend on read or move order. */
const reconcileAlbumMembers = (
    tx: Pick<DatabaseClient['db'], 'select' | 'update' | 'delete'>,
    albumIds: (string | null | undefined)[],
): void => {
    for (const affectedAlbumId of new Set(albumIds.filter((id): id is string => id != null))) {
        const members = tx
            .select({
                count: count(),
                dateAdded: max(songsTable.createdAt),
                coverPath: min(songsTable.coverPath),
            })
            .from(songsTable)
            .where(eq(songsTable.albumId, affectedAlbumId))
            .get()
        if (!members || members.count == 0) {
            tx.delete(albumsTable).where(eq(albumsTable.id, affectedAlbumId)).run()
        } else {
            tx.update(albumsTable)
                .set({ dateAdded: members.dateAdded, coverPath: members.coverPath })
                .where(eq(albumsTable.id, affectedAlbumId))
                .run()
        }
    }
}
