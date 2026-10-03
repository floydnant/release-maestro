---
name: file-pr
description: File a PR for completed work, then follow its CI and review comments. Use when asked to open or file a PR.
---

# File PR

- Run [code-review](../code-review/SKILL.md) on the change. Check its findings against the code and
  the user's intent, address those worth fixing, and verify the result. If the change belongs to a
  dependent set of PRs, use [github-stack](../github-stack/SKILL.md) to maintain the native stack.
- When a user-visible or interactive change would benefit from direct evidence, record screenshots
  or a screen recording. Post the evidence to related Linear tickets through the MCP, following
  [issue-tracker.md](../../../docs/agents/issue-tracker.md). If there is no related ticket, attach it
  to the PR. Link recorded evidence under `## Evidence` in the PR description. Skip this step when
  it adds no useful proof.
- Open the PR using [the repository template](../../../.github/pull_request_template.md), or submit
  the stack through `github-stack`. Watch CI and review comments on the current head. Validate each
  comment, address actionable ones, and repeat after pushing fixes. Finish when CI passes and the
  available actionable comments are resolved; report any review still pending.
