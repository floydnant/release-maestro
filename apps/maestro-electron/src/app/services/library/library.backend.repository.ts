import { PrescanFileFact, SongMetadata } from '@release-maestro/core'
import { randomUUID } from 'crypto'
import { and, asc, count, eq, gt, inArray, isNull, lt, max, ne, or } from 'drizzle-orm'
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
    labelsTable,
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
    normalizeDisplayText,
    relevantExternalRefsMap,
    stableHash,
} from './library-normalization'

export interface PrescanBatchComparison {
    unchanged: number
    changed: number
    new: number
    needsMetadata: PrescanFileFact[]
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
    constructor(private readonly database: DatabaseClient) {}

    nextScanSeenAt(): Date {
        const latest = this.database.db
            .select({ value: max(songsTable.lastSeenAt) })
            .from(songsTable)
            .get()?.value
        return new Date(Math.max(Date.now(), (latest?.getTime() ?? 0) + 1))
    }

    processPrescanBatch(facts: PrescanFileFact[], seenAt: Date): PrescanBatchComparison {
        if (facts.length == 0) {
            return { unchanged: 0, changed: 0, new: 0, needsMetadata: [] }
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
            needsMetadata: [],
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
                }

                if (!existing) {
                    tx.insert(songsTable)
                        .values({
                            id: randomUUID(),
                            path: fact.path,
                            ...fileValues,
                            title: titleFromFileName(fact.fileName),
                        })
                        .run()
                    comparison.new += 1
                    comparison.needsMetadata.push(fact)
                    continue
                }

                tx.update(songsTable).set(fileValues).where(eq(songsTable.id, existing.id)).run()

                if (existing.fileFingerprint == fingerprint) {
                    comparison.unchanged += 1
                } else {
                    comparison.changed += 1
                    comparison.needsMetadata.push(fact)
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

    listSongsNeedingMetadata(afterPath: string | null, limit: number): PrescanFileFact[] {
        const pendingCondition = or(
            isNull(songsTable.scannedFileFingerprint),
            ne(songsTable.scannedFileFingerprint, songsTable.fileFingerprint),
        )
        const where = afterPath
            ? and(eq(songsTable.present, true), pendingCondition, gt(songsTable.path, afterPath))
            : and(eq(songsTable.present, true), pendingCondition)

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

    countSongsNeedingMetadata(): number {
        return (
            this.database.db
                .select({ count: count(songsTable.id) })
                .from(songsTable)
                .where(
                    and(
                        eq(songsTable.present, true),
                        or(
                            isNull(songsTable.scannedFileFingerprint),
                            ne(songsTable.scannedFileFingerprint, songsTable.fileFingerprint),
                        ),
                    ),
                )
                .get()?.count ?? 0
        )
    }

    ingestMetadata(metadata: SongMetadata, fact: PrescanFileFact, scannedAt: Date): void {
        const db = this.database.db
        const rawArtist = metadata.artist
        const rawAlbumArtist = metadata.albumArtist
        const rawGenre = metadata.genre
        const artistText = normalizeDisplayText(rawArtist)
        const albumArtistText = normalizeDisplayText(rawAlbumArtist)
        const albumTitle = normalizeDisplayText(metadata.albumTitle)
        const genreText = normalizeDisplayText(metadata.genre)
        const labelText = normalizeDisplayText(metadata.label)
        const externalRefs = extractExternalRefs(metadata.extraMetadata, metadata.comment)

        db.transaction(tx => {
            const getOrCreateArtist = (name: string): string => {
                const existing = tx
                    .select({ id: artistsTable.id, externalRefs: artistsTable.externalRefs })
                    .from(artistsTable)
                    .where(eq(artistsTable.name, name))
                    .get()
                if (existing) {
                    tx.update(artistsTable)
                        .set({
                            externalRefs: mergeExternalRefs([
                                existing.externalRefs,
                                filterExternalRefs(externalRefs, relevantExternalRefsMap.artists),
                            ]),
                        })
                        .where(eq(artistsTable.id, existing.id))
                        .run()
                    return existing.id
                }

                const id = randomUUID()
                tx.insert(artistsTable)
                    .values({
                        id,
                        name,
                        externalRefs: filterExternalRefs(externalRefs, relevantExternalRefsMap.artists),
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

            const getOrCreateLabel = (name: string | null): string | null => {
                if (!name) return null
                const existingLabel = tx
                    .select({ id: labelsTable.id, externalRefs: labelsTable.externalRefs })
                    .from(labelsTable)
                    .where(eq(labelsTable.name, name))
                    .get()
                if (existingLabel) {
                    tx.update(labelsTable)
                        .set({
                            externalRefs: mergeExternalRefs([
                                existingLabel.externalRefs,
                                filterExternalRefs(externalRefs, relevantExternalRefsMap.labels),
                            ]),
                        })
                        .where(eq(labelsTable.id, existingLabel.id))
                        .run()

                    return existingLabel.id
                }

                const id = randomUUID()
                tx.insert(labelsTable)
                    .values({
                        id,
                        name,
                        externalRefs: filterExternalRefs(externalRefs, relevantExternalRefsMap.labels),
                    })
                    .onConflictDoNothing()
                    .run()
                return (
                    tx
                        .select({ id: labelsTable.id })
                        .from(labelsTable)
                        .where(eq(labelsTable.name, name))
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
            const labelId = getOrCreateLabel(labelText)
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
                    year: metadata.year,
                    date: normalizeDisplayText(metadata.date),
                    catalogNumber: normalizeDisplayText(metadata.catalogNumber),
                    coverPath: metadata.coverPath,
                    externalRefs: mergeExternalRefs([
                        existingAlbum?.externalRefs,
                        filterExternalRefs(externalRefs, relevantExternalRefsMap.albums),
                    ]),
                    labelId,
                } satisfies Omit<typeof albumsTable.$inferInsert, 'id'>

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
                    externalRefs: songsTable.externalRefs,
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
                rawLabel: metadata.label,
                title: normalizeDisplayText(metadata.title) ?? titleFromFileName(metadata.fileName),
                artistText,
                albumTitle,
                albumArtistText,
                genreText,
                labelText,
                catalogNumber: normalizeDisplayText(metadata.catalogNumber),
                year: metadata.year,
                trackNumber: metadata.track,
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
                externalRefs: mergeExternalRefs([existingSong?.externalRefs, externalRefs]),
                albumId,
            } satisfies Omit<typeof songsTable.$inferInsert, 'id'>

            if (existingSong) {
                tx.update(songsTable).set(songValues).where(eq(songsTable.id, songId)).run()
            } else {
                tx.insert(songsTable)
                    .values({ id: songId, ...songValues })
                    .run()
            }

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

            for (const issue of detectedIssues) {
                const fingerprint = issueFingerprint(issue)
                const existingIssue = existingIssuesByFingerprint.get(fingerprint)
                if (existingIssue) {
                    tx.update(normalizationIssuesTable)
                        .set({
                            issueType: issue.type,
                            field: issue.field,
                            value: issue.value,
                            lastSeenAt: scannedAt,
                            status: existingIssue.status == 'DISMISSED' ? 'DISMISSED' : 'OPEN',
                            closedAt: null,
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
        })
    }
}
