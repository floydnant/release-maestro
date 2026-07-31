# eslint-plugin-design-system

Class validation for the renderer: a styling class that resolves to no CSS is an error, not a
silent no-op.

Selected in [MAE-100](https://linear.app/floyd-haremsa/issue/MAE-100) out of three prototypes. The
convention it enforces is documented for humans and agents in
[`frontend-design`](../../../../.agents/skills/frontend-design/SKILL.md); this file is about how the
rules work and where they stop.

## The two rules

| Rule                                      | Surface                                                                                                                                                             |
| ----------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `design-system/valid-template-classnames` | `class`, `ngClass`, `routerLinkActive`, `[class]`, `[ngClass]`, `[class.foo]`, in `.html` files and in inline templates (via the Angular inline-template processor) |
| `design-system/valid-host-classnames`     | `@Component`/`@Directive` `host: { class: '…' }`                                                                                                                    |

Both are registered at `error` in `apps/maestro-renderer/eslint.config.mjs` — scoped to this
project, because the authorities they check against are this project's Tailwind config and
stylesheets.

## What makes a class known

There is no maintained allowlist. A class is known when **any** of these holds:

1. **Tailwind generates CSS for it.** The rule calls Tailwind's own `generateRules` against
   `tailwind.config.js`, so variants, arbitrary values, container queries and the config's plugin
   utilities (`glass`, `wrap-nicely`, `child-focus-ring`) are covered without restating any of them.
   The only literal list in the plugin is `group`/`peer` (+ named forms), variant markers that
   legitimately emit no CSS.

    The question is deliberately "does this emit CSS", not "is this a known Tailwind name". The
    config _replaces_ `spacing`, `borderRadius`, `boxShadow` and `opacity` with token scales that
    have no `DEFAULT` key, so `rounded` and `shadow` are real Tailwind names that produce nothing.
    A validator that checks names instead of output misses every one of them.

2. **An authored stylesheet declares it.** Class selectors are harvested with PostCSS from
   `src/styles.css` and everything it `@import`s — which is how `.type-*` from
   `design-tokens.generated.css` and `.btn-*`, `.badge`, `.panel` become known.

3. **The component's own styles declare it**, resolved from the component's `styleUrl`/`styleUrls`
   and inline `styles:`, read through the TypeScript compiler API. Component-scoped classes are
   known _only_ inside their own component.

Everything left of a `|` is a semantic descriptor and is never checked for existence. The list
shape is: zero or one descriptor, at most one pipe.

Three further checks ride along on the same tokens:

- **Nearest-name suggestion**, reported and never applied. Candidates come from the same three
  authorities, so a suggested name always passes. See below.
- **Bare design-token variables inside arbitrary values.** `bg-[color-mix(…var(--color-…)…)]` is a
  structurally valid utility hiding an unchecked token reference, so `var(--color-*)`,
  `var(--foundation-*)` and `var(--type-*)` are rejected there in favour of `theme(…)`.
  Component-local custom properties (`--progress-width`) are not design tokens and are untouched.
- **Theme paths.** `theme(...)` is the sanctioned replacement, but Tailwind resolves it only when
  the stylesheet is compiled — a misspelled path is a build error, not an editor diagnostic. The
  rule resolves the path against the same config, so `theme(colors.status.info.background)` is
  rejected in favour of `theme(colors.status.info-background)`.

## Suggestions: two kinds of "nearest"

Edit distance is right for typos and actively wrong for scale values, which is what the prototype
comparison surfaced. `max-h-72` is one edit from `max-h-32` and four scale steps away from it; the
value a human reaches for is `max-h-64`. So scale proximity is tried first and edit distance is the
fallback:

| Unknown        | Suggested      | Why                                             |
| -------------- | -------------- | ----------------------------------------------- |
| `max-h-72`     | `max-h-64`     | nearest value in the utility's own scale        |
| `py-14`        | `py-12`        | tie between 12 and 16 goes to the smaller value |
| `rounded`      | `rounded-sm`   | bare utility → the scale's first real step      |
| `fleex`        | `flex`         | edit distance                                   |
| `type-code-sl` | `type-code-sm` | edit distance                                   |
| `bg-nonsense`  | —              | no candidate is close enough to be one guess    |

## Dynamic class lists

Statically enumerable bindings are validated like any other class list: `[class.foo]`, `[ngClass]`
object keys, `[class]` conditionals and concatenations. What cannot be enumerated is reported as
`dynamicClassList` rather than quietly accepted — moving a class into a binding is not a bypass.

One exception, from MAE-100's corpus: an expression **rooted in an export of
`src/app/shared/design-tokens.generated.ts`** is accepted, because the generated signature's
TypeScript union already decides which token names are legal. The check is on the _root_ identifier
of the call or property chain and nothing more, so it does not see through a component method that
wraps the generated call.

Everything else uses a narrow `eslint-disable-next-line` with a reason. Three sites in the renderer
do — `'type-' + token` in the design-system specimen and two closed-vocabulary helpers in
`debug.component.html`. Note that `eslint-disable-next-line` is line-based and Prettier's attribute
wrapping can move the reported line away from the comment; a multi-line binding needs a
`eslint-disable` / `eslint-enable` pair around the element instead.

## Tests

The acceptance corpus is [`plugin.spec.cjs`](plugin.spec.cjs), one file tracking MAE-100's shared
corpus case by case (`R*` = reject, `A*` = accept, plus `R7`/`S1` from the comparison). It runs
under Jest in the Node environment:

```bash
npx nx run maestro-renderer:tooling-test
```

[`fixtures/specimen.component.html`](fixtures/specimen.component.html) is a committed file the spec
lints from disk, so the file-backed authorities — component stylesheet, inline `styles:`, the
template-to-component mapping — are exercised for real rather than through synthetic snippets.

## Known limits

| Case                                                            | Status                                                                                                                      |
| --------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| Bare design tokens in `.css` files                              | **out of scope** — ESLint has no CSS language wired here; this is [MAE-109](https://linear.app/floyd-haremsa/issue/MAE-109) |
| Class vocabularies defined as string literals in component TS   | **unsupported** — closed but invisible to both rules; needs a suppression                                                   |
| Class applied by a parent component's stylesheet or `::ng-deep` | **would be a false positive** — none exist in the renderer today                                                            |
| Classes applied imperatively (`classList.add`)                  | **out of scope** — banned rather than validated, see [MAE-108](https://linear.app/floyd-haremsa/issue/MAE-108)              |

**Cache invalidation is the one real hazard.** Tailwind's context is built once per ESLint process
and stylesheets are cached by mtime, but ESLint's own per-file cache is keyed on the file the class
came from, not on the authorities. Editing `tailwind.config.js` or a global stylesheet does not
invalidate it, so a long-lived editor server can hold a stale verdict until the template itself
changes. A full `nx lint` run is unaffected because nx re-runs the process.

Cost over the whole renderer is roughly 0.15 s of a ~3.7 s lint — inside run-to-run noise. ESLint's
file cache works normally, so a warm re-lint is ~1 s for the project and effectively instant for a
single open file.
