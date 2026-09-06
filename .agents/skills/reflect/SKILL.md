---
name: reflect
description: Spawn three parallel review subagents over the active transcript, surface learnings, and route each to a concrete edit on an existing skill. Use when the user says reflect.
disable-model-invocation: true
---

# Reflect

Mine the current conversation for durable learnings, then route them into skill edits.

## When to invoke

- The user said "reflect" or "/reflect".
- A complex task (5+ tool calls) just landed cleanly and the recipe is worth keeping.
- The agent hit dead ends, found the working path, and the path generalizes.
- The user corrected the agent's approach mid-task.
- A non-trivial workflow emerged that isn't captured anywhere.

Skip when the conversation is trivial, off-topic, or already covered by an existing skill the parent followed correctly. One-offs are not learnings.

## Process

### 1. Locate the active transcript

The parent finds its own transcript file before fanning out. Harnesses record sessions in different places; the system prompt or environment usually names the directory for the active workspace. Use that path, and stay inside it — a harness keeps every project's transcripts under one root, so a wider glob crosses workspace boundaries and reads private conversations from unrelated projects.

```bash
ls -t <transcript-dir>/*.jsonl <transcript-dir>/*/*.jsonl <transcript-dir>/*/subagents/*.jsonl 2>/dev/null | head -10
```

Layouts vary: flat (`<id>.jsonl`), nested (`<id>/<id>.jsonl`), and sub-agent (`<parent>/subagents/<child>.jsonl`). Adjust the glob to what the harness actually writes.

For each candidate, read the first record and check that its user-message text contains the conversation's opening prompt. Take the matching path. If no path resolves, write a tight digest of the session and pass that instead — every downstream step accepts a digest in place of a path.

### 2. Spawn three reviewers in parallel

One message, three general-purpose sub-agents through the available parallel delegation capability, each pinned to an explicit model. Give them full tool access rather than a read-only mode: reviewers need the environment's MCP servers for context lookups (tickets, chat threads, observability traces referenced in the transcript), and read-only modes typically strip those. The prompt forbids file writes; the parent applies edits.

| Lens      | Model                                                             | Prompt template                    |
| --------- | ----------------------------------------------------------------- | ---------------------------------- |
| Judgment  | the strongest reasoning model available                           | `references/judgment-reviewer.md`  |
| Tooling   | a strong model from a **different vendor** than the judgment lens | `references/tooling-reviewer.md`   |
| Divergent | the strongest reasoning model available                           | `references/divergent-reviewer.md` |

Vendor diversity on the tooling lens is the point, not any particular model: three lenses on one family converge and the fan-out buys nothing. If the environment defines a model roster for reflect, use it. If only one family is available, vary reasoning effort and say so in the summary.

Pass each template verbatim, substituting the transcript path or digest where marked. Reviewers return findings in their response body.

If the runtime cannot delegate, run the three lenses yourself in sequence with separate working notes so the findings stay independent, and note in the summary that they shared one model.

### 3. Synthesize

One general-purpose sub-agent on the strongest reasoning model available, with full tool access. The synthesizer's quality check includes spot-verifying citations, which can require MCP access that read-only modes strip. Use `references/synthesizer.md` verbatim, with each reviewer's full output inlined where marked. The synthesizer returns a structured Accepted / Rejected / Backlog list.

### 4. Structural enforcement check

Sanity-check the synthesizer's Accepted list. For any item that would be enforced more reliably by a lint rule, script, metadata flag, or runtime check, move it from Accepted to Backlog. Skill prose is for what a mechanism cannot enforce. The synthesizer already applies this criterion; this is a final pass before edits land.

### 5. Apply

Before applying any Accepted edit, present the synthesizer's full Accepted/Rejected/Backlog output to the user and wait for explicit approval. The user picks which subset to apply and may redirect routings. Skill changes affect every future agent in the org; do not auto-apply.

Backlog items file to whatever devex / backlog tracker your team uses automatically. Those are tracker submissions, not skill edits. Only the Accepted list waits for approval.

**Skill-authoring reference.** Anything past a one-line edit goes through the skill-authoring guidance rather than freehand: your harness's own skill-authoring skill if it ships one, otherwise `.agents/skills/writing-for-agents/SKILL.md` (with `SKILL-MECHANICS.md` beside it for frontmatter and the invocation choice). Draft, test the trigger, iterate.

For each approved Accepted item, follow the Routing field exactly:

- Trivial existing-skill edit (a one-line bullet, a tightened sentence, a stale fact corrected): parent does directly.
- Substantive existing-skill edit (a new section, a new pattern table, more than ~10 lines): follow the skill-authoring reference.
- `tune description: <skill path>` (the skill exists but didn't trigger when it should have): rewrite the description against the pointer-writing rules in the skill-authoring reference, then check it fires on the prompt that missed.
- `new skill: <kebab-name>`: create it through the skill-authoring reference. Do not invent the shape ad hoc.

If your environment ships a SKILL.md validator, run it on every touched skill before declaring done. Skip this step if it doesn't.

### 6. Summarize for the user

Short list, no preamble:

- Edits applied: `<skill path>`. What changed, one line each.
- New skills created: `<skill path>`. One line each (rare).
- Backlog filed to the devex tracker: `<issue title>` (`<tags>`). One line each.
- Dropped: one line per rejected finding + reason from the synthesizer.
