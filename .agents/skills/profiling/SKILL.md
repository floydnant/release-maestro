---
name: profiling
description: Find where the running app spends time or leaks memory, using renderer performance traces, main-process CPU profiles, and heap snapshot comparison. Use when a scan or import is slow, the UI janks or drops frames, or memory grows over a session. Attach first with `inspect-running-app`.
---

# Profiling

[`inspect-running-app`](../inspect-running-app/SKILL.md) covers attaching to the running app. This
skill covers what to measure once attached.

## Choose the process first

Guessing wrong here wastes the whole session, because each profiler is blind to the other process.

| Symptom                                           | Profile         | How                       |
| ------------------------------------------------- | --------------- | ------------------------- |
| Slow scan or import, slow browse query            | main, inspector | `Profiler` over raw CDP   |
| Jank, dropped frames, slow render or route change | renderer, CDP   | `performance_start_trace` |
| Memory grows over a session                       | either          | heap snapshots, see below |

The main process coordinates scans and runs SQLite queries. A renderer trace cannot attribute
that work. Start on the inspector port from `make dev-status` for slow scans, but the Rust
metadata-engine is a separate child process.
A Node CPU profile shows its caller's work, not time inside Rust; investigate the sidecar separately
when elapsed time grows while the main process is idle.

## Renderer traces

```
performance_start_trace  (reload: false, autoStop: false)
  exercise the interaction
performance_stop_trace
performance_analyze_insight
```

The trace returns insight sets split by navigation. Ask for one insight at a time rather than
reading the whole trace.

For interaction latency, read the main-thread call tree rather than load-time vitals.
Development load timings include the worktree's renderer server. Measure packaged startup
separately when investigating launch speed. Accessibility audits answer a different question
and remain useful in the running app.

## Main-process CPU profiles

Run the repository helper, then exercise the app during its sampling window:

```bash
node apps/maestro-electron/tools/profile-main-process.cjs 15
```

Run it from the repository root. It calls `cli.mjs dev-status --json` from the current directory,
connects to that worktree's inspector port, and prints the hottest
sampled leaf frames as bounded JSON. The helper uses raw CDP but owns request deadlines, socket
cleanup, and output bounds. Reach that port directly when you need an inspector command it does not expose; raw CDP remains the
zero-dependency floor. `HeapProfiler.enable` and `HeapProfiler.takeHeapSnapshot` answer main-process
allocation questions.

## Heap snapshots and leaks

The comparison tools (`compare_heapsnapshots`, `get_heapsnapshot_summary`,
`get_heapsnapshot_retainers`, `get_heapsnapshot_dominators`, `get_heapsnapshot_class_nodes`) exist
only when the server runs with `--memoryDebugging`. Both project client configs set it. If those
tools are absent from your tool list, the server started without the flag.

Read snapshots through the MCP tools. A raw `.heapsnapshot` file is large enough to swamp your
context, so never open one directly. Call `close_heapsnapshot` when you finish with each.
Use an absolute path under the directory returned by `node -p "require('os').tmpdir()"`. Codex may
not advertise a workspace root to the MCP server, and `/tmp` is not the same canonical directory on
macOS.

Amplify before you measure:

1. `take_heapsnapshot` for a baseline.
2. Repeat the suspect interaction about ten times, so a small leak clears the noise.
3. `take_heapsnapshot` again.
4. Revert to the starting state, then take a third snapshot. Check persistent growth and retainers;
   retained memory can also be an intentional cache.
5. Call `get_heapsnapshot_summary` on all three snapshots. If growth persists, select a class with a
   retained-object filter, then call `compare_heapsnapshots` with its `classIndex`. An unfiltered
   comparison can return thousands of rows.

`get_heapsnapshot_class_nodes` takes a `filterName` that maps directly onto the usual causes:
`objectsRetainedByDetachedDomNodes`, `objectsRetainedByEventHandlers`,
`objectsRetainedByContexts`, and `objectsRetainedByConsole`.

### Leak shapes in this codebase

- **A subscription that outlives its component.** See
  [`rxjs-streams`](../rxjs-streams/SKILL.md) for subscription lifetime, and check
  `objectsRetainedByEventHandlers`.
- **Detached DOM from a virtualized list.** The browse grids window large result sets
  ([ADR 0004](../../../docs/adr/0004-browse-queries-are-windowed-and-selections-carry-a-query.md)),
  so detached rows accumulate when a view holds a reference to a removed node. Detached nodes are
  sometimes a deliberate cache, so check ownership and expected lifetime before changing code.
- **A cache with no bound.** Cover art and browse windows both cache. Check whether the growth
  tracks a limit or the library size.
- **A closure holding a large row set.** Look for a query result captured by a long-lived handler.
