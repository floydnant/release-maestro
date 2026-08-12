# Album attributes the grid sorts by are denormalized columns, maintained by the write side

The albums grid sorts by record label and date added, and ADR 0004 requires every sortable column to
be index-backed. Neither is naturally a column on `albums`: a record label is a name on
`record_labels`, and a date added is an aggregate over `songs` (`MAX(created_at)` — an album is as new
as the most recent file on it). Ordering through either does exactly the whole-catalog work ADR 0004
exists to prevent — `ORDER BY (SELECT MAX(created_at) …)` evaluates the aggregate for every album
before it can pick the first window's rows, then sorts them in a temp B-tree, since no index on
`albums` covers a correlated subquery, and a join reaching off the table is no more indexable. So both
are denormalized onto `albums` as `record_label_text` and `date_added`, and the song-ingest
transaction keeps them true.

**An attribute earns a column when an _ordering_ depends on it, not when a tile displays it.** Song
count is the counter-example: it was a column, the grid stopped offering it as a sort, and it went
back to a live `COUNT` over the album ids a window returned. Aggregating _after_ the window is bounded
by the window, which is all ADR 0004 asks. If a later slice wants to sort by an aggregate, the column
comes back — with an index and a backfilling migration.

Recomputing the columns at the end of a scan instead, in one `UPDATE … FROM`, would be simpler and
could not drift. It was rejected because browse surfaces refetch _while_ a scan ingests (ADR 0004):
the grid would spend the whole scan ordered by dates that contradict the detail page beside it.

## Consequences

- **The write side owns a read-side concern**, which is the cost. `LibraryBackendRepository`
  recomputes `date_added` for both the album a song joins and the one it left, in the same transaction
  as the song upsert. Recomputed rather than adjusted: an adjustment would have to know whether the
  song was already on the album, and a re-read of an unchanged file means it was. Reconciliation
  touches neither column — a missing song is still a song on the record.
- **A migration adding one has to backfill it**, because the write side only recomputes an album when
  one of its songs is re-read, and an unchanged file is never re-read.
- **Only the query plan can catch the ordering regressing**, since a live aggregate returns identical
  rows — `library-browse.scale.spec.ts`. That the columns are _true_ is the Electron E2E's, the only
  layer that runs ingest, and `date_added` needs a fixture whose albums are **interleaved**: with each
  album's files written in one run, `MAX` and `MIN` over its songs give the same ordering and assert
  nothing.
