# The main process owns the scan lifecycle; the renderer is a mirror

Library scans outlive any window: they start at app launch before a window exists, and must survive
navigation, reloads, and a second window opening. So `LibraryScanService` in the main process owns
the scan — at most one at a time. Racing triggers resolve by intent: the background `startup` rescan
attaches to whatever is in flight, while a user-initiated trigger (`onboarding`, `manual`, `debug`)
takes over — it may exist precisely because the folders just changed, which the running scan knows
nothing about, so it cancels that scan and restarts once it has unwound. Starts are serialized so a
takeover can never leave two scans live. The renderer holds no scan state of its own; `LibraryService`
mirrors what it is told.

## Why full snapshots instead of deltas

Every `library:scan-status` broadcast carries the whole `LibraryScanStatus`, throttled to a
dirty-flag tick. A renderer that mounts late, reloads, or misses a tick therefore needs no replay
protocol — the next snapshot is already complete. `(scanId, revision)` totally orders snapshots, so
the pushed stream and the pulled `library:get-scan-status` seed can race freely and the renderer
never regresses to stale state.

Only the mosaic album covers are delta-shaped (`newAlbums`), because they accumulate without bound;
they are deduped by content-addressed cover path, which makes replays idempotent. Both sides retain
just a bounded tail of the previews — the mosaic samples the recent window near the scan cursor
anyway, so a whole library's worth of covers would be dead weight in memory.

## Consequences

- Adding a field to the scan status costs nothing protocol-wise. Adding a second _stream_ costs an
  ordering story — prefer widening the snapshot.
- Scan state persists to its own `conf` file under the _data_ dir, not the config dir: it is derived
  state that belongs with the database, and its own file keeps it out of reach of a renderer
  `set-settings` that replaces the whole settings store.
