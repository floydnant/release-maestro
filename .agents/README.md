# Skills

`.agents/skills/` holds vendored skills tracked in `skills-lock.json` plus repo-owned ones that are
not in the lock and must survive a re-sync.

Vendored skills are generic. Apply this repository's rules when they mention a different task runner,
context layout, or tool name. In particular, prototype commands go through Make/Nx rather than a new
`package.json` script, and references to an “Agent tool” mean the available parallel delegation
capability; if none exists, do the work locally.

`.agents/skills/<name>/SKILL.md` is the only copy of a skill. Harness directories hold adapters:
`.claude/skills/<name>` is a relative symlink to `../../.agents/skills/<name>`, and Codex reads the
canonical tree through each skill's `agents/openai.yaml` sidecar, whose `allow_implicit_invocation`
must agree with the SKILL.md `disable-model-invocation` flag. A skill that genuinely needs to differ
per harness is declared in [.agents/harness-overrides.json](.agents/harness-overrides.json) and only
then may be a real directory instead of a link — anything else divergent is a mistake.

`make agents-check` verifies all of that offline, plus frontmatter and cross-skill links. Run it
after adding, renaming, or removing a skill; CI runs it on every pull request.
