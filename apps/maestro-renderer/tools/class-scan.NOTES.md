# MAE-107 — standalone Angular/Tailwind class scanner (prototype)

**Question:** can a standalone scanner reject class names that neither Tailwind nor the project's own
CSS can produce — without a hand-maintained allowlist, and without an ESLint rule?

**Answer: yes.** Every case in MAE-100's shared corpus is decided or explicitly recorded as
unsupported, the scan of the whole renderer takes ~0.2 s (~0.43 s including Node start-up), and it
found 39 real defects in the current codebase, with zero false positives.

This is one of three MAE-100 prototypes ([MAE-105](https://linear.app/floyd-haremsa/issue/MAE-105),
[MAE-106](https://linear.app/floyd-haremsa/issue/MAE-106), MAE-107) and deliberately does **not** pick
a winner.

## What it does

`node apps/maestro-renderer/tools/class-scan.cjs scan [--json] [--severity=warn|error]`, or
`make class-scan` (fails on findings) / `make class-scan-report` (reports without failing):

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
    - **The generated token module** — the exported names of `design-tokens.generated.ts` decide which
      dynamic expressions count as legitimate typed token selection.

### Rules

| Rule                          | What it rejects                                                                 |
| ----------------------------- | ------------------------------------------------------------------------------- |
| `unknown-class`               | a class no authority can produce                                                |
| `malformed-descriptor`        | an empty descriptor, more than one descriptor, or more than one `\|` separator  |
| `unresolved-class-expression` | a class name built at runtime from something the scanner cannot enumerate       |
| `bare-design-token`           | `var(--color-…\|--foundation-…\|--type-…)` in product CSS or an arbitrary value |
| `invalid-suppression`         | a suppression comment that does not say why                                     |

Two conventions come from MAE-104: everything before a `|` in a class list is a semantic descriptor
and is **not** checked for existence (though the syntax of the convention itself is), and a class
glued to a dynamic fragment (`'badge ' + tone()`) is dropped rather than guessed at.

### Suppression

Deliberately narrow, and there is **no** file-level, glob-level or global ignore list:

```html
<!-- class-scan-disable-next-line: owned by index.html, outside the Angular tree -->
<div class="app-shell"></div>
```

The comment covers the next line only, and by extension the element whose start tag opens on that
line, so a multi-line tag does not need a comment per attribute. A suppression without an explanation
is itself reported as `invalid-suppression`.

## Corpus results

All cases live in [`class-scan.node-test.cjs`](class-scan.node-test.cjs) as data, with an explicit
verdict each. `make class-scan` runs them first (`npx nx run maestro-renderer:class-scan-test`).

### Accept — the scanner must stay silent

| Case                                                                      | Result |
| ------------------------------------------------------------------------- | ------ |
| Static utility, semantic-token utility, generated `type-*` class          | pass   |
| Built-in, responsive and project-defined variants (`not-hover:`)          | pass   |
| Plugin utilities (`glass`, `wrap-nicely`, `child-focus-ring`)             | pass   |
| `!important` modifier                                                     | pass   |
| Global component classes (`btn-primary`, `badge`, `panel`)                | pass   |
| Class from the owning component's stylesheet                              | pass   |
| Component-local custom properties (`[--rotation:45deg]`)                  | pass   |
| Variant markers (`group`, `peer`, `group/item`) and `cdk-*` / `ng-*`      | pass   |
| Descriptor before `\|`; `[ngClass]` key using the descriptor pipe         | pass   |
| Design token consumed through the Tailwind namespace                      | pass   |
| Typed/generated API for dynamic token selection (`semanticColor(tone())`) | pass   |

### Reject — the scanner must report

| Case                                                                    | Result                               |
| ----------------------------------------------------------------------- | ------------------------------------ |
| Misspelled utility (`fleex`)                                            | pass                                 |
| Unknown static class (`type-code-sl`) — Tailwind silently emits nothing | pass, suggests `type-code-sm`        |
| Class absent from the owning component **and** global CSS               | pass                                 |
| Class owned by a _different_ component's stylesheet                     | pass                                 |
| Utility outside the project scale (`p-7`, `max-h-72`, `rounded`)        | pass                                 |
| `[class.foo]`, `[ngClass]` objects/arrays/ternaries, `[attr.class]`     | pass                                 |
| `routerLinkActive`, static and bound; interpolated `class`              | pass                                 |
| Classes inside `@if` / `@for` / `@switch` / `ng-template` / `*ngIf`     | pass                                 |
| Host metadata `class` and `[class.x]`                                   | pass                                 |
| Empty descriptor before `\|`                                            | pass (`malformed-descriptor`)        |
| More than one descriptor before `\|`                                    | pass (`malformed-descriptor`)        |
| More than one `\|` separator                                            | pass (`malformed-descriptor`)        |
| Bare design-token variable inside a Tailwind arbitrary value            | pass (`bare-design-token`)           |
| Bare design-token variable in product CSS                               | pass (`bare-design-token`)           |
| `'type-' + token` and other untyped runtime construction                | pass (`unresolved-class-expression`) |
| Suppression comment with no explanation                                 | pass (`invalid-suppression`)         |

### Unsupported — recorded, never guessed at

| Case                                                    | Why                                                                         |
| ------------------------------------------------------- | --------------------------------------------------------------------------- |
| Classes applied through `element.classList.add(…)`      | outside every class surface the scanner parses                              |
| Classes produced by a TypeScript helper and bound whole | reported as `unresolved-class-expression`; the scanner does not evaluate TS |
| Bare design tokens in `src/styles.css`                  | the global sheet is shared token infrastructure, not product styling        |

Unsupported cases are asserted as _not reported_ (beyond the unresolved marker), so the prototype
cannot quietly start guessing.

## What it found in the current renderer

39 findings, all genuine, in four families:

- **21 × `bare-design-token`** — component stylesheets reach for `var(--foundation-motion-*)` directly
  (`app.component.css`, `progress-bar`, `progress-ring`, `import-mosaic`), and
  `folder-list.component.html` smuggles `var(--color-status-info-background)` and
  `var(--color-background-surface)` through Tailwind arbitrary values. Both bypass the configured
  namespace; `theme('transitionDuration.fast')` and `bg-status-info-background` exist for exactly this.
- **15 × `unknown-class`** — utilities outside this project's theme scales (`max-h-72`, `max-h-44`,
  `min-h-36`, `py-14`, `opacity-80`, `rounded` twice — the config _replaces_ `spacing`, `opacity` and
  `borderRadius` with token scales, so these emit no CSS at all), plus class names nothing declares
  (`app-shell`, `track-control`, `track-seeker`, `favicon`, `mosaic-cell`, `settings-item`,
  `progress-bg`). The latter are either dead styling classes or semantic descriptors that predate the
  `|` convention; the scanner cannot tell those apart by design, and adding the pipe resolves them.
- **3 × `unresolved-class-expression`** — `'type-' + token` in the design-system specimen and two
  concatenations in `debug.component.html`.
- **0 false positives** and **0 `invalid-suppression`**.

They are **not** fixed here — that is app work, not prototype work.

## CI integration

Demonstrated in [`.github/workflows/quality.yml`](../../../.github/workflows/quality.yml): the `lint`
job runs `make class-scan-report`, which executes the identical scan at warning severity and exits 0.
Severity is the whole switch — `make class-scan` is the same scan as an error gate — so the rule can
report on `main` today and be promoted to enforcement once the 39 findings are cleared, without a
second wiring exercise. It is deliberately _not_ inside `maestro-renderer:lint`'s `dependsOn` chain
yet, because that would fail `main` immediately.

## Performance

Measured on this machine; renderer at 15 components / 1367 class usages / 283 unique classes.

| Command                                                 | Time    |
| ------------------------------------------------------- | ------- |
| Scan work itself, warm process (self-reported)          | ~0.21 s |
| `node tools/class-scan.cjs scan`, cold                  | ~0.43 s |
| `node --test class-scan.node-test.cjs` (corpus)         | ~0.51 s |
| `npx nx run maestro-renderer:class-scan-report`         | ~1.4 s  |
| `npx nx lint maestro-renderer` for comparison, no cache | ~7.1 s  |

**Caching opportunities.** The Nx target is currently uncached, and at 1.4 s that has not mattered.
Three levers exist if it ever does: (1) declare `cache: true` with inputs limited to
`src/**/*.{ts,html,css}` plus `tailwind.config.js` and the token JSON, which makes an unchanged
renderer free; (2) cache the Tailwind resolution itself, keyed on the config hash plus the candidate
set — it is the dominant cost and the candidate set changes far less often than the files do; (3) a
per-file mode for a pre-commit hook, which the architecture allows (every step is per-component
except the single Tailwind pass) but which is not implemented.

Cost is dominated by the one Tailwind JIT pass and grows with unique candidates, not with file count.

## Trade-offs

**Strengths**

- No allowlist anywhere. Tailwind config changes, new plugins, renamed tokens and new global
  components are picked up with no scanner edit. The only hardcoded exemptions are three Tailwind
  marker classes and three framework prefixes.
- Understands the whole Angular class surface, including inline templates and host metadata, with
  exact positions inside `.ts` files.
- Cheap and independent: one Node process, no ESLint or Angular build involvement, trivially runnable
  in a pre-commit hook or CI step, and severity is a flag.
- Suggestions are offered only when unambiguous; an edit-distance tie produces no suggestion rather
  than a misleading one. It never auto-corrects.

**Weaknesses**

- **No editor diagnostics, and no cheap path to them.** This is the big one against MAE-105/MAE-106.
  Findings appear when you run the target, not while you type. The feasible routes are all real
  projects: a VS Code extension or LSP server wrapping this scanner (the JSON output is already
  positioned for it), a file-watcher writing a problem-matcher-friendly log, or re-homing the checks
  as ESLint rules — which is precisely what MAE-106 prototypes. As a standalone tool it will not
  produce squiggles.
- Depends on `@angular/compiler` and on Tailwind selector round-tripping via
  `postcss-selector-parser`. A Tailwind 4 upgrade would need this path re-verified.
- Component-scoped validity is approximated by "the styles this component declares"; `::ng-deep` from
  a parent and classes styled by an ancestor component are reported as unknown. **No such false
  positive exists in this repository today**, but the risk is structural, not hypothetical.
- False negatives are structural too: anything assembled outside a class surface (`classList.add`, a
  computed string returned by a helper) is invisible or, at best, an `unresolved-class-expression`.
- Runs over the whole renderer every time; no incremental mode.
- One more standalone tool to keep alive next to `design-tokens.cjs`, rather than one more rule in a
  linter that already runs.

## Files

- [`class-scan.cjs`](class-scan.cjs) — the scanner and its CLI
- [`class-scan.node-test.cjs`](class-scan.node-test.cjs) — the acceptance corpus
- `maestro-renderer:class-scan` / `class-scan-report` / `class-scan-test` Nx targets,
  `make class-scan` / `make class-scan-report`
