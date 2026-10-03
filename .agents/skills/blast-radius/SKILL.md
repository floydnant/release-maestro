---
name: blast-radius
description: Trace what a proposed or completed code change could break beyond its diff, then test the key assumption that makes it safe. Use when asked for blast radius, downstream impact, or what else a change could break, or when code review identifies a credible risk of consequential downstream breakage.
---

# Blast radius

Find consequential breakage beyond the edited files. Start with the changed behavior and the
claim that makes it safe. A list of direct callers is only the start.

1. Establish the change and its scope. For a diff, include committed and uncommitted work unless
   the user narrowed it. Name the changed symbols, data shapes, side effects, and timing.
2. Trace each affected path through callers and consumers, including indirect ones. Check
   serialized content, IPC payloads, database state, routes, caches, external APIs, configuration,
   build artifacts, and code in other languages when they apply. Inspect the pinned dependency's
   behavior in its source or docs when the safety claim depends on it.
3. State the one or two assumptions that decide whether the change is safe. For each, cite the
   code or contract, describe a reachable failure sequence, and give the cheapest decisive check.
   During code review, the parent owns checks and follows the verification-evidence policy in
   `.agents/skills/code-review/SKILL.md`. Reuse a clear relevant result; otherwise run the check
   against real code when practical. A focused existing test, temporary script, or
   running-app reproduction can establish the result. Keep temporary probes out of the committed
   tree unless they protect a lasting regression.
4. Report only credible risks. For each, say what breaks, the path that reaches it, likely impact,
   and the evidence. Separate confirmed risks, cleared paths, and assumptions still unproven.
   Name the exact next check for an unproven claim. Do not present a search with no matches as
   proof that an indirect consumer does not exist.

Use this repository's boundaries while tracing: Electron main and Angular renderer ownership,
shared core schemas and IPC contracts, the Rust metadata-engine sidecar, library versus release-feed
persistence, async lifecycle and cancellation, and development versus packaged app behavior. Read
`CONTEXT-MAP.md`, the relevant ADRs, and `docs/testing.md` before choosing a proof.

Return a short account of the changed behavior, the decisive safety claim and how far it was
verified, then confirmed risks, cleared paths, and the smallest remaining check. Cite code lines
and paste the result of any probe. Say "unproven" when the claim has not been exercised.
