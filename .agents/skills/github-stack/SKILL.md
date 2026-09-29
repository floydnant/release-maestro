---
name: github-stack
description: Use GitHub's native gh-stack CLI when planning dependent changes, splitting a large PR, or updating a stack.
---

# GitHub stacks

## When to stack

Split before coding when distinct reviewable changes depend on each other, such as a refactor
followed by its feature. Independent changes get separate PRs. Keep tightly coupled work together.
Each layer must pass checks with its ancestors and include its own tests and docs.

## Workflow

Use the official `github/gh-stack` extension. If missing, run `gh extension install github/gh-stack`.
It uses `gh` authentication; run `gh auth login` if unauthenticated. Keep all branches in the same
repository. Preserve unrelated work and start branch changes with a clean working tree.

1. Run `gh stack init <first>`, commit the first layer, then `gh stack add <next>` from the top
   and commit the next. Adopt existing branches with `gh stack init <bottom> <next> <top>`.
   This registers branches; it does not split an existing diff.
2. Check `gh stack view` and each layer's diff. The bottom targets the default branch;
   higher layers target their predecessor. `init --base <branch>` overrides the trunk.
3. Run the narrowest relevant checks from [verification-loop](../verification-loop/SKILL.md)
   for every layer, then publish with `gh stack submit`. Fill each PR body using
   [the repository template](../../../.github/pull_request_template.md). New PRs default to ready
   for review. Use draft only when a layer is knowingly not mergeable.
4. Navigate with `gh stack switch`, `gh stack up`, or `gh stack down`. Commit feedback on its owning
   layer, run `gh stack rebase --no-trunk`, verify affected layers, then `gh stack push`.
   Use `gh stack rebase` to include trunk updates. Resolve and stage conflicts before
   `gh stack rebase --continue`; use `gh stack rebase --abort` to restore. Push can partially succeed;
   inspect rejected leases before retrying. Use `submit` for newly added PRs.
5. Resume with `gh stack checkout <PR-URL>`. Use `gh stack sync` after remote changes or merges;
   it rebases and pushes but never opens PRs. Inspect its result.

Confirm GitHub checks pass on each PR's current SHA and resolve actionable review threads.
Reverify affected layers after rebasing; a green top layer does not prove the rest. Native stacks
use trunk protection rules and CI branch filters for every layer. Native merge includes the
selected PR and its unmerged ancestors atomically.

Use the commands above for routine work. For an error, uncertainty, or an operation not covered
here, consult `gh stack <command> --help`, then the
[CLI reference](https://docs.github.com/en/pull-requests/reference/stacked-prs-cli-commands) if needed.
