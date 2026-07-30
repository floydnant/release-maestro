# MAE-107 — standalone Angular/Tailwind class scanner (prototype)

**Question:** can a standalone scanner reject class names that neither Tailwind nor the project's own
CSS can produce — without a hand-maintained allowlist, and without an ESLint rule?

**Answer: yes.** 27/27 corpus cases behave as specified, the scan of the whole renderer takes ~0.2 s
(~0.45 s including Node start-up), and it found 15 real defects in the current codebase on its first
run, with zero false positives.

This is one of three MAE-100 prototypes ([MAE-105](https://linear.app/floyd-haremsa/issue/MAE-105),
[MAE-106](https://linear.app/floyd-haremsa/issue/MAE-106), MAE-107) and deliberately does **not**
pick a winner.

> **Caveat on the shared corpus.** The Linear MCP was not connected in the implementing session, so
> MAE-100's shared acceptance corpus could not be read verbatim. The corpus in
> [`class-scan.node-test.cjs`](class-scan.node-test.cjs) was reconstructed from the handoff document
> and the class surfaces actually present in this repository. Re-run it against MAE-100's list before
> comparing prototypes; the cases are data, so adding or renaming one is a one-line change.

## What it does

`node apps/maestro-renderer/tools/class-scan.cjs scan` (or `make class-scan`):

1. **Finds the class surfaces.** Every `@Component` in `src/app` is read with the TypeScript compiler
   API for its template (inline or `templateUrl`), its styles (inline or `styleUrls`), and its `host`
   metadata. Templates nobody claims are scanned with their sibling stylesheet.
2. **Extracts class names** with Angular's own template parser (`@angular/compiler`), covering
   `class`, `routerLinkActive`, `[class.foo]`, `[class]`, `[ngClass]`, `[attr.class]`, host metadata,
   and everything nested in `@if` / `@for` / `@switch` / `@defer` / `ng-template`. Binding expressions
   are walked as an AST: object keys, array elements, ternary branches, string concatenation and
   interpolation.
3. **Derives the truth set, never authors it:**
    - **Tailwind** — all collected candidates are pushed back through Tailwind's JIT compiler in one
      pass; a candidate is a real utility only if it emits CSS. Variants, arbitrary values, plugins and
      `!important` all round-trip for free because Tailwind itself answers.
    - **Global CSS** — class selectors in `src/styles.css` and `src/styles/design-tokens.generated.css`.
    - **Component CSS** — the styles a component owns, valid only inside that component's template.
4. **Reports** `file:line:column`, the class, its surface, and a near-miss suggestion. Exit code 1 on
   findings.

Two conventions are encoded, both from MAE-104: everything before a `|` in a class list is a semantic
descriptor and is **not** validated, and a class glued to a dynamic fragment (`'badge ' + tone()`) is
dropped rather than guessed at.

## Corpus results

All cases live in [`class-scan.node-test.cjs`](class-scan.node-test.cjs) (`make class-scan` runs them
first, or `npx nx run maestro-renderer:class-scan-test`).

| Case                                                                    | Result                                                  |
| ----------------------------------------------------------------------- | ------------------------------------------------------- |
| Static utility, semantic-token utility, generated `type-*` class        | pass                                                    |
| Unknown static class (`type-code-sl`) — Tailwind silently emits nothing | pass, with `type-code-sm` suggested                     |
| Utility outside the project scale (`p-7`, `max-h-72`, `rounded`)        | pass — flagged                                          |
| Arbitrary values with commas/nested `var()`/`color-mix()`               | pass                                                    |
| Built-in, responsive and project-defined variants (`not-hover:`)        | pass                                                    |
| Plugin utilities (`glass`, `wrap-nicely`, `child-focus-ring`)           | pass                                                    |
| `!important` modifier                                                   | pass                                                    |
| Global component classes (`btn-primary`, `badge`, `panel`)              | pass                                                    |
| Class from the component's own stylesheet                               | pass                                                    |
| Descriptor before `\|`, styling half still validated                    | pass                                                    |
| Variant markers (`group`, `peer`, `group/item`) and `cdk-*`/`ng-*`      | pass                                                    |
| `[class.foo]`, `[ngClass]` objects/arrays/ternaries, `[attr.class]`     | pass                                                    |
| `[ngClass]` key using the descriptor pipe                               | pass                                                    |
| Concatenation: complete literals validated, glued token dropped         | pass                                                    |
| `routerLinkActive`, static and bound                                    | pass                                                    |
| Interpolated class attribute                                            | pass                                                    |
| Classes inside `@if` / `@for` / `@switch` / `ng-template` / `*ngIf`     | pass                                                    |
| Host metadata `class` and `[class.x]`                                   | pass                                                    |
| Fully dynamic expression (`'type-' + token`)                            | **unsupported** — reported as unresolved, never flagged |
| Class assembled through `element.classList.add(…)`                      | **unsupported** — outside every parsed surface          |

Unsupported cases are asserted as _not reported_, so the prototype cannot quietly start guessing.
The scan prints unresolved dynamic expressions with `--verbose` (3 in this repository) as an
inventory, not as failures.

## What it found in the current renderer

15 findings, all genuine, in two families:

- **Utilities outside this project's theme scales** — `max-h-72`, `max-h-44`, `min-h-36`, `py-14`,
  `opacity-80`, and `rounded` (twice). The Tailwind config _replaces_ `spacing`, `opacity` and
  `borderRadius` with token scales, so these emit no CSS at all. This is exactly the failure mode the
  existing `design-tokens check` cannot see.
- **Class names nothing declares** — `app-shell`, `track-control`, `track-seeker`, `favicon`,
  `mosaic-cell`, `settings-item`, `progress-bg`. Either dead styling classes or semantic
  descriptors/runtime hooks that predate the `|` convention. The scanner cannot tell the two apart by
  design (MAE-100 leaves descriptor purity to MAE-104); adding the pipe resolves them.

They are **not** fixed here — that is app work, not prototype work — which is why `class-scan` is a
standalone target and is _not_ wired into `lint`, `build` or `test`. Adopting it means clearing the
15 findings first, then adding it to the renderer's `dependsOn` chain.

## Performance

Measured on this machine, renderer at 15 components / 1367 class usages / 283 unique classes:

| Command                                                                 | Time    |
| ----------------------------------------------------------------------- | ------- |
| Scan work itself (self-reported)                                        | ~0.21 s |
| `node tools/class-scan.cjs scan`, cold                                  | ~0.45 s |
| `npx nx run maestro-renderer:class-scan` (incl. corpus tests, no cache) | ~4.5 s  |
| Same, Nx cache hit                                                      | ~1.5 s  |
| `npx nx lint maestro-renderer` for comparison, no cache                 | ~7.1 s  |

Cost is dominated by the single Tailwind JIT pass and grows with unique candidates, not with file
count.

## Trade-offs

**Strengths**

- No allowlist anywhere. Tailwind config changes, new plugins, renamed tokens and new global
  components are picked up with no scanner edit.
- Understands the whole Angular class surface, including inline templates and host metadata, with
  exact positions inside `.ts` files.
- Cheap and independent: one Node process, no ESLint or Angular build involvement, trivially runnable
  in a pre-commit hook or CI step.
- The rules are data (`markerClasses`, `externalPrefixes`, the corpus table), so the policy is
  readable in one screen.

**Weaknesses**

- **No editor feedback.** This is the big one against MAE-105/MAE-106: findings appear when you run
  the target, not while you type. Nothing here would surface in an IDE without extra work.
- Depends on `@angular/compiler` and Tailwind internals-adjacent behaviour (selector round-tripping
  through `postcss-selector-parser`). A Tailwind 4 upgrade would need this path re-verified.
- Component-scoped validity is approximated by "the styles this component declares"; `::ng-deep` from
  a parent and classes styled by an ancestor component are reported as unknown.
- Runs over the whole renderer every time; there is no per-file incremental mode, though at 0.45 s
  that has not mattered.
- One more standalone tool to keep alive next to `design-tokens.cjs`, rather than one more rule in a
  linter that already runs.

## Files

- [`class-scan.cjs`](class-scan.cjs) — the scanner and its CLI
- [`class-scan.node-test.cjs`](class-scan.node-test.cjs) — the acceptance corpus
- `maestro-renderer:class-scan` / `class-scan-test` Nx targets, `make class-scan`
