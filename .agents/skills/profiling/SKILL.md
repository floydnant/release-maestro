---
name: profiling
description: Find where the running app spends time or leaks memory, using renderer performance traces, main-process CPU profiles, and heap snapshot comparison. Use when a scan or import is slow, the UI janks or drops frames, or memory grows over a session. Attach first with `inspect-running-app`.
---

# Profiling

[`inspect-running-app`](../inspect-running-app/SKILL.md) covers attaching to the running app. This
skill covers what to measure once attached.

## Choose the process first

Guessing wrong here wastes the whole session, because each profiler is blind to the other process.

| Symptom                                           | Profile        | How                       |
| ------------------------------------------------- | -------------- | ------------------------- |
| Slow scan or import, slow browse query, sidecar   | main, 5858     | `Profiler` over raw CDP   |
| Jank, dropped frames, slow render or route change | renderer, 9222 | `performance_start_trace` |
| Memory grows over a session                       | either         | heap snapshots, see below |

The scan pipeline, the SQLite queries, and the metadata-engine sidecar all run in the main process.
A renderer trace shows none of that work. When a scan feels slow, start on 5858.

## Renderer traces

```
performance_start_trace  (reload: false, autoStop: false)
  exercise the interaction
performance_stop_trace
performance_analyze_insight
```

The trace returns insight sets split by navigation. Ask for one insight at a time rather than
reading the whole trace.

Largest Contentful Paint and the other load vitals mean little here. The renderer loads from
`localhost:4200` in development and `file://` when packaged, so treat load-time insights as noise
and read the main-thread call tree instead.

## Main-process CPU profiles

No MCP server drives the Node inspector, so use raw CDP against
`http://127.0.0.1:5858/json/list`:

```
Profiler.enable
Profiler.start
  exercise the app
Profiler.stop
```

`nodes[].callFrame` with `hitCount` gives the attributed hot frames. `HeapProfiler.enable` and
`HeapProfiler.takeHeapSnapshot` answer main-process allocation questions.

## Heap snapshots and leaks

The comparison tools (`compare_heapsnapshots`, `get_heapsnapshot_summary`,
`get_heapsnapshot_retainers`, `get_heapsnapshot_dominators`, `get_heapsnapshot_class_nodes`) exist
only when the server runs with `--memoryDebugging`. `.mcp.json` sets it. If those tools are absent
from your tool list, the server started without the flag.

Read snapshots through the MCP tools. A raw `.heapsnapshot` file is large enough to swamp your
context, so never open one directly. Call `close_heapsnapshot` when you finish with each.

Amplify before you measure:

1. `take_heapsnapshot` for a baseline.
2. Repeat the suspect interaction about ten times, so a small leak clears the noise.
3. `take_heapsnapshot` again.
4. Revert to the starting state, then take a third snapshot. Memory that never returns is the leak.
5. `compare_heapsnapshots` without a `classIndex` first, then drill into one suspicious class.

`get_heapsnapshot_class_nodes` takes a `filterName` that maps directly onto the usual causes:
`objectsRetainedByDetachedDomNodes`, `objectsRetainedByEventHandlers`,
`objectsRetainedByContexts`, and `objectsRetainedByConsole`.

### Leak shapes in this codebase

- **A subscription that outlives its component.** The most common one here. See
  [`rxjs-streams`](../rxjs-streams/SKILL.md) for subscription lifetime, and check
  `objectsRetainedByEventHandlers`.
- **Detached DOM from a virtualized list.** The browse grids window large result sets
  ([ADR 0004](../../../docs/adr/0004-browse-queries-are-windowed-and-selections-carry-a-query.md)),
  so detached rows accumulate when a view holds a reference to a removed node. Detached nodes are
  sometimes a deliberate cache, so confirm with the user before you change code.
- **A cache with no bound.** Cover art and browse windows both cache. Check whether the growth
  tracks a limit or the library size.
- **A closure holding a large row set.** Look for a query result captured by a long-lived handler.
