---
name: rxjs-streams
description: How Release Maestro uses RxJS for asynchronous pipelines, in BOTH the Electron main process (`apps/maestro-electron`) and the Angular renderer (`apps/maestro-renderer`). Covers when a stream beats async/await, choosing flattening operators, wrapping callback and child-process sources, batching, cancellation, and subscription lifetime. Use for any work on scan/import progress streams, IPC event streams, or anything that arrives over time. For renderer state and component structure see angular-patterns.
---

# RxJS Streams

This repo uses RxJS deliberately and narrowly: **for work where time is part of the problem.** Streams
that arrive over time, work that must be cancelled or sequenced, several sources combined,
backpressure. Everywhere else, plain `async`/`await` is correct and shorter.

That test applies identically on both sides of the IPC boundary. The main process streams scan and
import progress; the renderer consumes those streams and turns them into state.

## When RxJS, when async/await

**Use a stream** when any of these is true: values arrive more than once, the consumer may need to
cancel, order or concurrency between operations matters, two sources must be combined, or a producer
outpaces its consumer.

**Use `async`/`await`** for a single request/response — most IPC handlers, most repository reads. A
one-shot wrapped in an `Observable` is noise. `firstValueFrom` exists for the seam where a stream API
has to be consumed once.

**Don't use RxJS for synchronous derived values.** In the renderer that is `computed()`; on the backend
it is a function.

## Choosing the flattening operator

This is the decision that matters most, because it is behavior rather than style, and the wrong choice
produces bugs that pass every test.

- **`switchMap`** — cancel the in-flight one, latest wins. Supersedable work: search, navigation, a
  re-triggered load.
- **`concatMap`** — queue, preserve order, drop nothing. Sequential writes, ordered persistence,
  batched inserts.
- **`exhaustMap`** — ignore new work while busy. Idempotent triggers: submit buttons, "start scan".
- **`mergeMap`** — full concurrency, no ordering guarantee. Only when order and cancellation genuinely
  do not matter.

A `mergeMap` where `exhaustMap` belonged starts two of something on a fast double-click, and
[ADR 0001](../../../docs/adr/0001-main-process-owns-scan-lifecycle.md) says exactly one scan runs
app-wide — so this is a live correctness constraint here, not a style preference. Never nest
subscribes to avoid the choice; flatten and pick.

## Patterns already in this codebase

Read these before inventing a new shape.

**Wrapping a non-Rx source.** `apps/maestro-electron/src/app/services/email/apple-mail.repository.ts`
turns a spawned AppleScript process into an `Observable` via a `Subject`: `next()` per parsed message,
`complete()` when the process exits, and the `AbortSignal` tears it down. When wrapping a source that
emits, this is the shape — a `Subject` you own and complete, not a bare `new Observable` with manual
bookkeeping.

**Wrapping an event emitter.** `fromEventPattern` is how the renderer's `feed.service.ts` and
`library.service.ts` adapt `ipcRenderer.on` into a stream. Prefer it over a hand-rolled `Subject` when
the source is already an add/remove listener pair.

**Batching a fast producer.** `feed.backend.service.ts` uses `bufferCount(50)` followed by
`concatMap` — collect 50, then process batches strictly in order. That pairing is the idiom for a
producer faster than its consumer where order still matters; `bufferCount` with `mergeMap` would
silently interleave.

**Carrying errors across a boundary.** The same file uses `materialize()` so completion and error
become ordinary values that survive the IPC hop, then reconstitutes them on the far side. A raw error
thrown inside a stream does not cross `ipcRenderer` intact.

**Combining independent progress sources.** `merge()` of several materialized branches into one
progress stream, so the renderer subscribes once.

## Cancellation

Cancellation is explicit here, and it is usually an `AbortSignal` arriving from an IPC call rather than
an unsubscribe. When a stream owns a resource — a child process, a file handle, a worker — wire the
signal to tear that resource down and complete the stream. Do not rely on the consumer unsubscribing;
in the main process there may not be one.

A cancelled stream must still terminate cleanly. See
[ADR 0003](../../../docs/adr/0003-unreachable-folders-make-their-tracks-missing.md) for why a
cancelled scan's partial results are treated differently from a completed one — cancellation changes
the meaning of the data, not just the control flow.

## Subscription lifetime

- Every subscription needs a defined end. In the renderer that is `takeUntilDestroyed()`; an
  `ipcRenderer.on` listener that outlives its component fires forever and stacks up on re-entry.
- In the main process, complete the `Subject` you created. A `Subject` that never completes is a leak
  with a long fuse.
- **Manual `.subscribe()` needs a reason.** Prefer landing a stream in state — see angular-patterns
  for `toSignal`/`toObservable` — over subscribing to assign.

## Testing streams

`apps/maestro-renderer/src/test/mocks.ts` uses `NEVER` and `Subject` to hold a stream open or drive it
by hand. Renderer E2E covers progress-stream UI through the scenario harness's `emit` helper rather
than through real observables — see `docs/testing.md`.
