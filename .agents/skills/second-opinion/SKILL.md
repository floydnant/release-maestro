---
name: second-opinion
description: Ask a different vendor's agent, over its CLI, for a taste review or a blind-spot check on work this agent produced. Use when the user asks for a second opinion, a sanity check from another model, or pairs one with a review.
---

# Second opinion

An agent reviewing its own work brings its own blind spots to the reading. This skill hands the
question to a different vendor's CLI and reports what comes back.

## Invoke

```sh
claude -p --model claude-opus-5 --effort medium --permission-mode plan "<brief>"
```

Plan mode keeps it read-only. The brief is one argument: what to look at, where — paths, or a `git`
command it should run itself — and what to report. Never paste a large diff into the prompt; name the
command and let it read the repository.

## Spend it deliberately

This call draws on a subscription quota, so it is not free the way a local tool is. Reach for it when
a second vendor would genuinely change the answer — taste, architecture, a judgement two readers
could disagree about — and not for anything a test or a linter already settles. One well-framed call
beats three vague ones.

When the user says **watch usage** and names a limit, check it before and after each call:

```sh
usage claude:personal
```

It prints a 5h and a 7d window, each with a percentage used. When another call would carry the run
past the limit they named, stop and say so rather than quietly spending through it.

## Paired with code-review

If run alongside [code-review](../code-review/SKILL.md), this is a fourth axis. Give it its own heading
and lead with the harness and model that produced it:

    ## Second opinion
    claude / claude-opus-5, medium effort

Keep its findings verbatim. Don't merge or rerank them into the other axes — separation is the point
there, and a different vendor's read is exactly what averaging destroys.
