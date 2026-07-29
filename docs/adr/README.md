# Architectural Decisions

Decisions whose reasoning is not visible in the code. An ADR is a standing constraint: if a change
contradicts one, say so explicitly rather than quietly overriding it.

ADRs live here at the root rather than per project, because contexts cross project boundaries — see
[CONTEXT-MAP.md](../../CONTEXT-MAP.md). Format and when to write one:
[`.agents/skills/grill-with-docs/ADR-FORMAT.md`](../../.agents/skills/grill-with-docs/ADR-FORMAT.md).

| #    | Decision                                                                                                                                     | Context       |
| ---- | -------------------------------------------------------------------------------------------------------------------------------------------- | ------------- |
| 0001 | [The main process owns the scan lifecycle; the renderer is a mirror](./0001-main-process-owns-scan-lifecycle.md)                             | Music library |
| 0002 | [Scan UI is paced independently of the scan data](./0002-scan-ui-is-paced-independently-of-scan-data.md)                                     | Music library |
| 0003 | [An unreachable library folder makes its tracks missing, it does not fail the scan](./0003-unreachable-folders-make-their-tracks-missing.md) | Music library |
