# Album attributes the grid sorts by are denormalized columns, maintained by the write side

The albums grid sorts by track count and record label, and ADR 0004 requires every sortable column to
be index-backed. Neither is naturally a column on `albums`: a track count is an aggregate over
`songs`, and a record label is a name on `record_labels`. So both are denormalized onto `albums` —
`track_count` and `record_label_text` — and the song-ingest transaction keeps them true.

## Considered options

**Counting and joining per query** is what the schema already implies, and it is what a reader will
assume when they find a count stored in a table. It was rejected because
`ORDER BY (SELECT COUNT(*) …)` has to evaluate the aggregate for _every_ album before it can pick the
first window's rows — the whole-catalog work ADR 0004 exists to prevent, on a table designed for a
50k–500k-song library. The join for the record label is cheaper but has the same shape: an `ORDER BY`
that reaches through it cannot use an index on `albums`.

**Recomputing both at the end of a scan** in one `UPDATE … FROM` pass was the simpler alternative and
is genuinely tempting: one statement, no per-song bookkeeping, and it cannot drift. It was rejected
because browse surfaces refetch _while_ a scan ingests (ADR 0004), so the grid would spend the whole
scan showing counts that disagree with the tracks the detail page lists beside them — and the header
and the table on one screen would visibly contradict each other.

## Consequences

- **The write side owns a read-side concern**, which is the cost. `LibraryBackendRepository`
  recomputes `track_count` for both the album a song joins and the one it left, inside the same
  transaction as the song upsert. Recomputed rather than incremented, because an increment has to know
  whether the song was already on the album and a re-read of an unchanged file means it was.
- **Reconciliation does not touch either column.** A missing song is still a song on the record, so
  marking `present = false` leaves the count alone. Songs are never deleted, which is what keeps the
  set of events that can change a count down to "a song was ingested".
- **A schema migration has to backfill.** Adding the columns to an already-scanned library leaves
  every album reading zero tracks and no label, and nothing would correct it short of a full rescan —
  the write side only recomputes an album when one of its songs is re-read, and an unchanged file is
  never re-read. The `mae-119` migration backfills both.
- **Only the scale check can catch this going wrong.** A correctness test seeds the columns and a
  live count would return identical rows, so the assertion that matters is the query _plan_ — see
  `library-browse.scale.spec.ts`. That the write side keeps them _true_ is asserted by the Electron
  E2E over a real scan, which is the only layer that runs ingest.
