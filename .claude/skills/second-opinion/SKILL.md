---
name: second-opinion
description: Ask a different vendor's agent, over its CLI, for a taste review or a blind-spot check on work this agent produced. Use when the user asks for a second opinion, a sanity check from another model, or pairs one with a review.
---

# Second opinion

An agent reviewing its own work brings its own blind spots to the reading. This skill hands the
question to a different vendor's CLI and reports what comes back.

This is the Claude copy, which calls Codex. It diverges from the canonical
`.agents/skills/second-opinion/SKILL.md` only in which vendor it reaches for, and is declared in
`.agents/harness-overrides.json`. Edit both when the shape changes.

## Invoke

Include this instruction in every brief sent to the reviewing agent:

> Perform this review yourself and return your findings directly. Do not invoke the second-opinion
> skill or request another second opinion. This call is the final review level.

```sh
codex exec -m gpt-5.6-sol -c model_reasoning_effort="medium" -s read-only "<brief>"
```

`-s read-only` keeps it from writing. The brief is one argument: what to look at, where — paths, or a
`git` command it should run itself — and what to report. Never paste a large diff into the prompt;
name the command and let it read the repository.

Codex prints its reasoning and a token count around the answer. Report the answer.

## Paired with code-review

If run alongside [code-review](../code-review/SKILL.md), this is a fourth axis. Give it its own heading
and lead with the harness and model that produced it:

    ## Second opinion
    codex / gpt-5.6-sol, medium reasoning

Keep its findings verbatim. Don't merge or rerank them into the other axes — separation is the point
there, and a different vendor's read is exactly what averaging destroys.
