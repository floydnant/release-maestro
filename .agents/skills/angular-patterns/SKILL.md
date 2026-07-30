---
name: angular-patterns
description: How renderer code is structured in Release Maestro (`apps/maestro-renderer`) — signals as the state model, the signal/observable bridge, and when to extract a component. Use for any TypeScript or template work in the renderer. Pairs with frontend-design, which covers how the UI looks rather than how it is built; RxJS pipeline guidance for both processes lives in rxjs-streams.
---

# Angular Patterns

Two rules carry most of the weight: **signals hold state, RxJS moves events**, and **a template block
that has grown its own state is a component**. Both are already how this codebase works — writing them
down matters because a mixed-paradigm codebase drifts, and drift is what makes it unreadable.

Scope is the renderer. For the pipelines themselves — operator choice, cancellation, wrapping sources,
subscription lifetime — see `.agents/skills/rxjs-streams/SKILL.md`, which applies to the Electron main
process too.

## Signals are the state model

Anything a template reads, anything derived synchronously, anything a user action sets.

- `signal()` for owned state, `computed()` for anything derivable. Never keep a `signal` in sync by
  hand where a `computed` would do.
- `input.required<T>()` and `input()` for inputs; `output()` for outputs.
- `effect()` is a last resort for genuine side effects. An effect that writes a signal it also reads is
  a bug, and effects that exist only to copy one signal into another should be a `computed`.
- Don't reach for RxJS for synchronous derived state. A stream is for values that arrive over time.

## Bridge at the edges, never in the middle

`toObservable()` to enter a pipeline from signal state; `toSignal()` to land the result back where the
template can read it. State in, stream in the middle, signal out.

The worked example is `pages/feed/feed.component.ts`: paginated infinite scroll as
`toSignal(toObservable(furthestScrolledIndex).pipe(combineLatestWith(...), mergeScan(...)))`. Read it
before writing a new pipeline in a component.

**Do not subscribe in order to `set()` a signal.** That is the anti-pattern this rule exists to
prevent, and it is the most common way the convention gets broken — it reintroduces the imperative
mutation the stream was chosen to avoid, and drops the automatic teardown `toSignal` gives you.

## Componentization

Some page components are deliberately substantial, but page-specific components live beside their
page and shared components are promoted only after a second consumer appears. Default to extracting
when a block has a clear state or behavior boundary.

**Extract when any of these is true:**

- The block owns state or lifecycle nothing else on the page touches.
- It appears more than once, or obviously will.
- It has its own loading, empty, or error branch.
- Naming it is easy. If a clean name exists, the seam is real.
- The template passes ~150 lines, or one `@if` / `@for` body passes ~40.

**Don't extract when:**

- The only motive is line count, and the result would be a bag of unrelated inputs.
- It would need more than roughly four inputs plus two outputs — that means the seam is in the wrong
  place, not that it needs more inputs.
- Splitting would put tightly coupled state on both sides of an input/output boundary.

**Where it goes.** A component used by one page lives beside that page —
`pages/library-import/import-mosaic.component.ts` is the pattern. It moves to `shared/components/`
when a second consumer actually appears, not in anticipation of one.

**How it is written.**

- `ChangeDetectionStrategy.OnPush` always.
- Signal inputs and outputs, not the `@Input()` / `@Output()` decorators.
  `shared/components/progress-ring/progress-ring.component.ts` still uses decorators and is the
  outlier, not a second valid pattern.
- Prefer presentational components: inputs in, outputs out, no service injection. Let the page own the
  data fetching and pass results down.
- A component that takes a domain object should take the domain object, not eight primitives
  destructured from it.

## Naming

Components, inputs, and outputs use the vocabulary from the relevant `CONTEXT.md` — a component listing
unreachable library folders is not a `MissingDirsList`. See `docs/agents/domain.md`.
