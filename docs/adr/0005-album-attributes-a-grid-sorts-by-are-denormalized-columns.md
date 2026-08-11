# Album attributes the grid sorts by are denormalized columns, maintained by the write side

The albums grid sorts by record label and date added, and ADR 0004 requires every sortable column to
be index-backed. Neither is naturally a column on `albums`: a date added is an aggregate over `songs`
(`MAX(created_at)` — an album is as new as the most recent file on it), and a record label is a name on
`record_labels`. So both are denormalized onto `albums` — `record_label_text` and `date_added` — and
the song-ingest transaction keeps them true.

Date added arrived after the record label and changed nothing about the decision, which is why it is
recorded here rather than in an ADR of its own. It did raise the stakes: it is the grid's **default**
sort, so a stale or unpopulated column is what every user sees on opening the page rather than
something they have to go looking for.

**Song count was a third such column (`track_count`) and is not one any more.** The grid no longer offers it as a
sort — ordering a music library by how many tracks a record has answers no question anyone asks of it
— and being sortable was the only thing that made it a column. The tiles and the detail header still
show it, so it went back to being an aggregate; see the last consequence below for the form that takes
and why that form is not what this ADR rejected.

## Considered options

**Aggregating and joining per query** is what the schema already implies, and it is what a reader
will assume when they find a date stored in a table. It was rejected because
`ORDER BY (SELECT MAX(created_at) …)` has to evaluate the aggregate for _every_ album before it can
pick the first window's rows, and then sort the results in a temp B-tree because no index on `albums`
covers a correlated subquery. That is the whole-catalog work ADR 0004 exists to prevent, on a table
designed for a 50k–500k-song library. The join for the record label is cheaper but has the same shape:
an `ORDER BY` that reaches through it cannot use an index on `albums` either.
`library-browse.scale.spec.ts` asserts the absence of both, per sort field and per direction.

**Recomputing them at the end of a scan** in one `UPDATE … FROM` pass was the simpler alternative and
is genuinely tempting: one statement, no per-song bookkeeping, and it cannot drift. It was rejected
because browse surfaces refetch _while_ a scan ingests (ADR 0004), so the grid would spend the whole
scan ordered by dates that disagree with the tracks the detail page lists beside them — and the header
and the table on one screen would visibly contradict each other.

## Consequences

- **The write side owns a read-side concern**, which is the cost. `LibraryBackendRepository`
  recomputes `date_added` for both the album a song joins and the one it left, inside the same
  transaction as the song upsert. Recomputed rather than adjusted, because an adjustment has to know
  whether the song was already on the album and a re-read of an unchanged file means it was. The
  `MAX` runs over `songs_album_id_idx`.
- **Reconciliation does not touch either.** A missing song is still a song on the record, so marking
  `present = false` leaves the label and the date alone. Songs are never deleted, which is what keeps
  the set of events that can change either down to "a song was ingested".
- **A schema migration has to backfill.** Adding a column to an already-scanned library leaves every
  album with no label and no date, and nothing would correct it short of a full rescan — the write
  side only recomputes an album when one of its songs is re-read, and an unchanged file is never
  re-read. The `mae-119` migration backfills the label and `album-date-added` the date.
- **Only the scale check can catch this going wrong.** A correctness test seeds the columns and a
  live aggregate would return identical rows, so the assertion that matters is the query _plan_ — see
  `library-browse.scale.spec.ts`. That the write side keeps them _true_ is asserted by the Electron
  E2E over a real scan, which is the only layer that runs ingest. `date_added` needs a fixture written
  with its albums **interleaved** to be asserted at all: with each album's files written in one run,
  `MAX` and `MIN` over its songs produce the same ordering.
- **An attribute that is only displayed is aggregated after the window, not stored.** Song count is
  the worked example: `queryAlbums` runs one grouped `COUNT` over `songs_album_id_idx` for the album
  ids the window returned, and the detail page counts one album. That is not the option rejected
  above. The rejected one puts the aggregate inside the `ORDER BY`, where it has to be evaluated for
  every candidate row before SQLite knows which rows the window even holds; this one runs over the
  tiles already on screen, so its cost is bounded by the window exactly as ADR 0004 requires. **The
  test is whether an ordering depends on it.** If a future slice wants to sort by an aggregate, the
  column comes back — with an index and a backfilling migration.
