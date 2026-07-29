# Issue tracker: Linear

Issues and PRDs for this repo live in **Linear**, not GitHub Issues. A `#123` reference in a commit
subject or branch name is a GitHub pull request; Linear issues are referenced by team-prefixed key
(`ABC-123`).

- Workspace: `https://linear.app/floyd-haremsa`
- Team key: `MAE`

Use the Linear MCP tools when they are available. If the MCP is not connected or cannot see the team,
say so plainly and ask the maintainer for access or for the specific issue URL — do not fall back to
GitHub Issues.

## Conventions

- One work item per Linear issue. Keep the title short and specific.
- Longer requirements, checklists, and discussion go in the issue description or comments, not the
  title.
- When a skill says "publish to the issue tracker", create or update the Linear issue.
- When a skill says "fetch the relevant ticket", open the corresponding Linear issue and read its
  description **and** comments — decisions often live in the comments.
- When a bundled skill mentions GitHub Issues, `gh issue`, issue numbers, or GitHub labels, translate
  it to Linear unless the user explicitly asks for GitHub.
- PRDs are issues too, in the same team, distinguished by state and labels rather than by living
  somewhere separate. If that changes, document the split here.

## States and labels

Lifecycle is a Linear **workflow state** (Triage, Backlog, Todo, In Progress, Done, Canceled);
category and agent-readiness are **labels**. The `/triage` skill
([`.agents/skills/triage/SKILL.md`](../../.agents/skills/triage/SKILL.md)) is the source of truth for
both inventories and the transitions between them.

Do not invent new workflow states — they are workspace-level and affect every board. Labels are the
cheaper thing to add if a distinction is genuinely missing.
