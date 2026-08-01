# Browse queries are windowed, and a selection carries a query rather than a list of ids

The library is designed for collections of 50k–500k songs, so no browse surface ever loads the
catalog into the renderer. Every list fetches `LIMIT`/`OFFSET` windows over an indexed `ORDER BY`
plus one `COUNT` for the scrollbar, and the renderer holds only the rows currently on screen.

The consequence people trip over is selection. "Select all" cannot mean "an array of 500k ids" — that
array has to cross IPC and live in renderer memory. So a selection is not a list of songs. It is:

```
Selection = {
  query:    SongQuery       // the filter + sort this selection is relative to
  ranges:   [start, end)[]  // index ranges within that ordering
  excluded: SongId[]        // rows deselected inside those ranges
  included: SongId[]        // rows selected outside them
}
```

Actions take that structure and resolve it to rows in SQL, in the main process, where 500k rows is an
ordinary query. Nothing large ever crosses the IPC boundary.

## Considered options

**An array of ids** was the obvious alternative and is what most tables do. It was rejected on
payload: `Cmd-A` on a large library serialises hundreds of thousands of text UUIDs through structured
clone on every selection change.

**Two selection models** — ids for small hand-picked selections, a query for select-all — was also
considered and rejected as unnecessary. The structure above already handles both, because the two
cases differ in kind rather than in size:

| Gesture                | Representation                         | Size    |
| ---------------------- | -------------------------------------- | ------- |
| Click one row          | `included: [id]`                       | 1       |
| Cmd-click a handful    | `included: [id, id, id]`               | N       |
| Shift-click a range    | `ranges: [[12, 45)]`                   | 1 pair  |
| Multi-range            | `ranges: [[12,45), [900,1200)]`        | 2 pairs |
| Cmd-A                  | `ranges: [[0, total)]`                 | 1 pair  |
| Cmd-A minus three rows | `ranges: [[0,total)]`, `excluded: [3]` | 4       |
| First + last of 500k   | `included: [idFirst, idLast]`          | 2       |

Hand-picking is bounded by how many times a human can click, so explicit ids are always small. The
only unbounded gestures — range and select-all — are exactly the ones that compress to index pairs.
One model, with a hard ceiling on payload size.

## Consequences

- **Index ranges are meaningful only against a stable ordering.** Changing the filter or sort
  invalidates them, so the selection clears.
- **Live refetch during a scan can re-point a range.** Browse views refetch as a scan ingests songs,
  and inserts above a selected range silently shift what `[[12, 45)]` refers to — an action would hit
  the wrong files. Therefore: a selection holding any `ranges` is cleared whenever a refetch changes
  the row count. Selections made only of `included` ids are immune to drift and survive, because an id
  means the same song regardless of position.
- **Every sortable column needs an index.** Deep `OFFSET` over an unindexed `ORDER BY` makes SQLite
  build a temp B-tree per query. Adding a sortable column to a browse table is a schema change, not a
  UI change.
- **This is the seam playback will use.** "Play everything I'm looking at" is the same `SongQuery`,
  resolved in the main process — not a queue handed over from the renderer.
- **Search is deliberately not part of this decision.** It is `LIKE '%…%'` today and will not hold at
  the top of the size range. It is kept behind a single seam in the query layer so swapping in FTS5 is
  one file, not a rewrite of five pages.
