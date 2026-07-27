# Scan UI is paced independently of the scan data

Scan progress arrives far faster than it can be read. A startup rescan of an unchanged library
finishes in milliseconds, and the deep-read phase emits one album cover per file. Rendered
faithfully, the sidebar indicator flashes on and off, phases blink past unread, and the import mosaic
stutters and then bursts at completion. Both surfaces therefore deliberately lag the data.

- `MinDwellPacer` holds each _startup_ scan phase on screen for a minimum time
  (`STARTUP_PHASE_MIN_DWELL_MS`, 1s) before advancing or hiding. Payload updates within one phase
  pass through live — only phase changes and hiding are held back. Manual rescans are shown in real
  time, because the user asked for them and is watching.
- `ImportMosaicComponent` places covers at a constant cadence (`TICK_MS`) from a bounded sample
  (`MAX_PENDING`) of a moving recent-results window. The wall therefore builds at the same speed no
  matter how far ahead the scan is, while the covers roughly follow the scan's current cursor and
  completion cannot trigger a catch-up burst.

## Consequences

The UI intentionally reports state it no longer holds — a scan can be finished while the indicator
still shows "reading". This looks like a bug in a screenshot and like a race in a test. Do not
"fix" it by wiring the signals straight through.

Both mechanisms are injectable/deterministic for exactly this reason: `MinDwellPacer` takes its clock
and scheduler as constructor arguments, so tests drive time rather than wait on it.
