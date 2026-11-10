---
name: research
description: Investigate a question against high-trust primary sources and return sourced findings. Use when the user wants a topic researched, docs or API facts gathered, or reading legwork delegated to a background agent.
---

Spin up a **background agent** to do the research, so you keep working while it reads.

Its job:

1. Investigate the question against **primary sources** (official docs, source code, specs, first-party APIs), not a secondary write-up of them. Follow every claim back to the source that owns it.
2. Return the findings with source links to the caller. When the task calls for saving them, use the related Linear issue or PR discussion. Honor an explicitly requested file destination.
3. Before changing repository docs, apply the [repository documentation rule](../../../AGENTS.md#keeping-the-docs-true).
