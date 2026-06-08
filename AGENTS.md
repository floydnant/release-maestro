## Agent skills

Read [docs/agents/domain.md](docs/agents/domain.md), [docs/agents/issue-tracker.md](docs/agents/issue-tracker.md), and [docs/agents/triage-labels.md](docs/agents/triage-labels.md) before using the engineering skills in this repo.

### Domain docs

This is a multi-context monorepo. See `docs/agents/domain.md`.

Also see `docs/agents/issue-tracker.md` and `docs/agents/triage-labels.md`

### Issue tracker

Issues and PRDs live in Notion, not GitHub Issues. If a bundled skill says to create, fetch, comment on, or label a GitHub issue, apply that workflow to the Notion tracker described in `docs/agents/issue-tracker.md` instead.

### Validation loop

ALWAYS run verifications after making changes to code. Use the Makefile targets as the source of truth, starting with the narrowest relevant check. See `.agents/skills/verification-loop/SKILL.md`.

### Rules

- Commit messages use Conventional Commits with a mandatory type: prefix on the subject line
