# MAE-105 — class validation with `eslint-plugin-tailwindcss`

**Status:** prototype. One of three isolated experiments under MAE-100. Not a decision, not an
architecture proposal. Delete or absorb once MAE-100 picks a winner.

## Question

Can `eslint-plugin-tailwindcss` — configured, plus the smallest extension that exposes the real
boundary — deliver MAE-100's closed-world class contract for Angular templates?

The motivating failure: `class="type-code-sl"` type-checks, builds, renders, and silently produces no
CSS. Nothing in the repository catches it today.

## What was built

1. **Turned the upstream rule on.** `tailwindcss/no-custom-classname` was already installed and
   explicitly set to `off` in [eslint.config.mjs](/eslint.config.mjs).
2. **Pointed it at the global authorities.** `settings.tailwindcss.cssFiles` covers `styles.css` and
   the generated token CSS — the genuinely global stylesheets — so authored primitives (`.btn`,
   `.badge`, `.panel`) are recognised. **There is no whitelist and no ignore pattern:** Tailwind's own
   API already enumerates the `addUtilities()` output (`glass`, `child-focus-ring`, `wrap-nicely`),
   which an earlier iteration had wrongly hand-listed.
3. **Wrapped it for Angular.**
   [no-custom-classname.cjs](/tools/eslint/tailwindcss-angular/no-custom-classname.cjs) keeps the
   upstream rule as the _validation engine_ — it never re-decides what a valid class is — and adds
   only what upstream cannot express:
    - the `descriptor | utilities` convention, including malformed pipe syntax;
    - Angular class-producing surfaces (`[class]`, `[class.foo]`, `[ngClass]`, `[attr.class]`,
      `routerLinkActive`, `host: { class }`);
    - rejection of unresolved dynamic construction;
    - bare design-token variables inside arbitrary values;
    - scope-aware authored CSS ([component-css.cjs](/tools/eslint/tailwindcss-angular/component-css.cjs));
    - exact per-token locations and nearest-name suggestions
      ([nearest-name.cjs](/tools/eslint/tailwindcss-angular/nearest-name.cjs)).

The wrapper feeds extracted class names back into the _upstream_ rule as synthetic `class`
attributes, so Tailwind's `generateRules` stays the single source of truth for what exists.

### Scope-awareness, and how it is done

MAE-100 requires that "a selector owned by one Angular component must not make that class valid in an
unrelated component". Upstream's `cssFiles` is a single global pool and cannot express this. So
`cssFiles` was narrowed to global stylesheets only, and the wrapper resolves the _owning_ component's
classes per linted file — its `styleUrl(s)` files **and** its inline `styles:` literals — then filters
upstream's reports through that set. This also closes the inline-`styles:` false positive that the
first iteration had.

The report-filtering hook is a delegating context object (`Object.create(context, { report })`); a
`Proxy` trips ESLint 9's frozen-property invariant.

## Acceptance corpus

Run with `make prototype-classname-test`. Source:
[no-custom-classname.node-test.cjs](/tools/eslint/tailwindcss-angular/no-custom-classname.node-test.cjs).
Case ids follow MAE-100's shared corpus.

### Reject, or explicitly report unsupported

| #   | MAE-100 case                                    | Result                                        |
| --- | ----------------------------------------------- | --------------------------------------------- |
| R1  | unknown generated class `type-code-sl`          | **pass** — rejected, suggests `type-code-sm`  |
| R2  | unknown ordinary utility `fleex`                | **pass** — rejected, suggests `flex`          |
| R2b | unknown class with no clear candidate           | **pass** — rejected, no suggestion invented   |
| R3  | authored class absent from owner and global CSS | **pass**                                      |
| R3b | another component's scoped class does not leak  | **pass** — scope-aware                        |
| R4  | empty descriptor before the pipe                | **pass**                                      |
| R4b | multiple descriptors before the pipe            | **pass**                                      |
| R4c | more than one pipe                              | **pass**                                      |
| R4d | pipe glued to a class (`\|flex`)                | **pass**                                      |
| R4e | malformed pipe inside an `[ngClass]` key        | **pass**                                      |
| R5  | unresolved construction `'type-' + token`       | **pass** — rejected                           |
| R5b | fully opaque `[class]` binding                  | **pass** — rejected                           |
| R5c | opaque `[ngClass]` expression                   | **pass** — rejected                           |
| R6  | bare design token in a Tailwind arbitrary value | **pass**                                      |
| R6b | bare foundation token in an arbitrary value     | **pass**                                      |
| R6c | bare design token in product **CSS** files      | **unsupported** — ESLint does not lint `.css` |

### Accept

| #   | MAE-100 case                                          | Result                                  |
| --- | ----------------------------------------------------- | --------------------------------------- |
| A1  | valid utilities, modifiers, variants                  | **pass**                                |
| A2  | valid arbitrary layout values                         | **pass**                                |
| A3  | generated typography classes (`type-code-sm`)         | **pass**                                |
| A4  | real global authored classes                          | **pass**                                |
| A5  | classes from the owning component's scoped CSS        | **pass**                                |
| A5b | classes from the owning component's inline `styles:`  | **pass**                                |
| A6  | static class list, no descriptor, no pipe             | **pass**                                |
| A7  | exactly one optional descriptor before `\|`           | **pass**                                |
| A8  | statically enumerable conditional classes in bindings | **pass**                                |
| A9  | typed/generated API for dynamic token selection       | **unsupported** — see below             |
| A10 | component-local custom properties                     | **pass** — `--progress-color` untouched |

### Angular class-producing surfaces

| #   | Surface                                        | Result                                 |
| --- | ---------------------------------------------- | -------------------------------------- |
| S1  | literal `class`, incl. multi-line lists        | **pass** — exact token location        |
| S2  | `[class.foo]`                                  | **pass** — located on the key          |
| S3  | resolvable `[class]`, incl. `[attr.class]`     | **pass**                               |
| S4  | resolvable `[ngClass]`, enumerable object keys | **pass** — quoted and bare keys        |
| S5  | `routerLinkActive`, static and bound           | **pass**                               |
| S6  | component host classes (`host: { class }`)     | **pass**, incl. non-literal rejection  |
| U1  | `@HostBinding('class.foo')`                    | **unsupported** — silently unchecked   |
| U2  | `el.classList.add('foo')`, `renderer.addClass` | **unsupported** — silently unchecked   |
| U3  | class names assembled in component TypeScript  | **unsupported** — silently unchecked   |
| U4  | `@apply` typos inside `.css`                   | **unsupported** — `.css` is not linted |

**A9 is the honest failure.** MAE-100 wants typed/generated APIs accepted for legitimate dynamic
token selection, but a lint rule cannot distinguish `typographyClass(token)` from any other call. The
approach therefore falls back to MAE-100's other sanctioned escape hatch — a narrow, explained
suppression — verified on the real renderer (three sites, below). If MAE-100 wants type-level
acceptance, that has to come from the type system, not from this rule.

## Diagnostics

- **Exact token.** Invalid classes are underlined at the class itself, not at the attribute —
  including inside multi-line class lists, `[ngClass]` keys, `[class.foo]` keys, and concatenation
  operands. Asserted with `column`/`endColumn` in the corpus.
- **Nearest name.** `type-code-sl` → `type-code-sm`, `fleex` → `flex`, `items-centre` →
  `items-center`. Candidates come from Tailwind's `getClassList()` plus the CSS authorities; a tie or
  a distance over 3 yields **no** suggestion rather than a guess.
- **No automatic correction.** The candidate is offered as an ESLint _suggestion_, which is never
  applied by `--fix`. The corpus asserts exactly one suggestion per suggested error.
- **Editor.** The rule lives in the flat config, so VS Code underlines as you type; no separate scan
  or command. Severity stays configurable through ordinary lint config, so MAE-100 can run it at
  `warn` before enforcing.
- **Unresolved construction** is reported on the _owning element's_ opening line, because an HTML
  comment cannot live inside a tag — reporting deeper inside a multi-line binding would leave nowhere
  to write `eslint-disable-next-line`.

## What it found in the real repository

Running the final rule against the renderer as it was **before** this branch: **21 errors in 8
files**, no false-positive flood.

| Population                                        | Count | Disposition                    |
| ------------------------------------------------- | ----- | ------------------------------ |
| classes that exist in source and emit no CSS      | 5     | removed (see below)            |
| semantic descriptors not yet migrated to the pipe | 8     | moved left of `\|`             |
| bare design-token variables in arbitrary values   | 5     | rewritten to `theme(...)`      |
| unresolved dynamic class construction             | 3     | narrow, explained suppressions |

**Dead classes.** Verified independently with `generateRules` — all five produce zero rules, because
`tailwind.config.js` _replaces_ `theme.spacing` and `theme.opacity` with design tokens instead of
extending them.

| Class        | Site                                    | Nearest valid value                    |
| ------------ | --------------------------------------- | -------------------------------------- |
| `py-14`      | folder-list dropzone                    | spacing scale stops at `12`, then `16` |
| `opacity-80` | folder-list "tracks are marked missing" | `opacity-70`                           |
| `max-h-72`   | debug page, twice                       | `max-h-[18rem]`                        |
| `min-h-36`   | debug page textarea                     | `min-h-[9rem]`                         |
| `max-h-44`   | debug page                              | `max-h-[11rem]`                        |

They render as nothing today, so deletion is behaviour-preserving. Restoring the lost intent is a
design decision, not a lint fix — the table is the hand-off.

**Bare design tokens.** Five arbitrary values in `folder-list.component.html` reached for
`var(--color-…)` directly. Rewritten to `bg-[color-mix(in_srgb,theme(colors.status.info-background)_50%,transparent)]`
and friends. The built stylesheet is byte-identical in effect — `theme()` resolves to the same
`var(--color-…)` — but the path is now validated by Tailwind, so a misspelled token fails the build.

**Descriptors.** `mosaic-tile`, `mosaic-tile--enter/--leave` and `mosaic-veil` turned out to be _real_
component-scoped CSS classes rather than annotations; scope-awareness now accepts them where they are
declared, so they were moved back to the validated half of the class list.

**False positives found: none.** Every finding was a real defect, a real convention gap, or a real
token bypass.

## Cost

Renderer only (`apps/maestro-renderer/src/**/*.{ts,html}`, 3 runs each, this machine):

| Run                                 | Time                  |
| ----------------------------------- | --------------------- |
| `npx eslint` with the rule off      | 3.41s / 3.36s / 3.43s |
| `npx eslint` with the rule on       | 4.46s / 3.74s / 3.94s |
| `npx nx lint maestro-renderer` cold | 7.21s                 |
| `npx nx lint maestro-renderer` warm | 0.59s (Nx cache hit)  |

≈0.5s, ~15% over the lint baseline. The Tailwind context and the suggestion candidate list are built
once per lint process; `cssFiles` are re-read at most every `cssFilesRefreshRate` (5s default);
per-component CSS is cached on the same 5s window. Nx caches the whole target, so a warm CI or
editor-adjacent run pays nothing.

## Honest assessment

**What this approach buys**

- Editor feedback for free — it is an ESLint rule in the flat config, nothing else to run.
- Validation logic is not ours. Tailwind's `generateRules` decides what exists. Arbitrary values,
  variants, prefixes and plugin utilities are handled upstream, not by a regex we maintain.
- No duplicate authority: no whitelist, no ignore pattern. Everything accepted comes from the Tailwind
  config, a global stylesheet, or the owning component's own CSS.
- Small blast radius: a config change plus three small files, with the upstream rule still the engine.

**What it costs**

- **The pipe convention stops being optional.** The rule cannot tell a semantic descriptor from a
  typo, so every descriptor must sit left of a `|` — including descriptor-only lists, which become
  `class="favicon |"`. That trailing pipe has to be accepted as a rule of the house.
- **Imperative class names are out of reach.** `@HostBinding('class.x')`, `classList.add`,
  `renderer.addClass` and fully computed TypeScript strings are silently unchecked (U1–U3). Silence is
  deliberate, but it is a coverage hole, not a pass.
- **No typed-API acceptance (A9).** Legitimate dynamic token selection needs a suppression, not
  recognition.
- **CSS is not covered (R6c, U4).** `@apply` typos and bare tokens inside `.css` still slip through.
  Whatever MAE-100 chooses, that gap needs a separate answer — probably the stylelint/scan half of the
  problem.
- **Upstream dependency risk.** The wrapper deep-imports
  `eslint-plugin-tailwindcss/lib/rules/no-custom-classname` and shadows `context.report`, neither of
  which is a stable API. The plugin is on 3.18.3 with a pending 4.x bump (PR #100) that targets
  Tailwind 4; the wrapper would need re-validating there.
- **Scope-awareness is heuristic.** The owning component's CSS is found by sibling filename,
  `styleUrl(s)` strings, and a hand-rolled scan of `styles:` literals — not by the TypeScript type
  checker. It is right for this codebase's conventions and would need hardening before shipping.

## Reproduce

```sh
make prototype-classname-test          # acceptance corpus
npx nx lint maestro-renderer           # rule running for real
```
