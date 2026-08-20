# eslint-plugin-design-system

Class validation for the renderer: a styling class that resolves to no CSS is an error, not a
silent no-op.

Selected in [MAE-100](https://linear.app/floyd-haremsa/issue/MAE-100) out of three prototypes. The
convention it enforces is documented for humans and agents in
[`frontend-design`](../../.agents/skills/frontend-design/SKILL.md); this file is about how the rules
work and where they stop.

The library knows nothing about Release Maestro's design system, or any other. Its configured
authorities — the Tailwind config and the global stylesheets — arrive as rule options, which is what
makes it a library rather than a folder of scripts, and what would make publishing it a packaging
question rather than a rewrite.

## The two rules

| Rule                                      | Surface                                                                                                                                                             |
| ----------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `design-system/valid-template-classnames` | `class`, `ngClass`, `routerLinkActive`, `[class]`, `[ngClass]`, `[class.foo]`, in `.html` files and in inline templates (via the Angular inline-template processor) |
| `design-system/valid-host-classnames`     | `@Component`/`@Directive` `host: { class: '…' }` and `host: { '[class.foo]': … }`                                                                                   |

Both are registered at `error` in the renderer's
[`eslint.config.mjs`](../../apps/maestro-renderer/eslint.config.mjs), which turns on typed member
resolution and explains why registration is per-project.

| Option              | Default    | Meaning                                                                                                                      |
| ------------------- | ---------- | ---------------------------------------------------------------------------------------------------------------------------- |
| `tailwindConfig`    | required   | The config whose utilities and theme paths are the authority.                                                                |
| `globalStylesheets` | `[]`       | Stylesheets whose authored classes count as known everywhere.                                                                |
| `reportDynamic`     | `true`     | Report class lists that cannot be enumerated. Off silences the whole category.                                               |
| `resolveTypes`      | `false`    | Resolve an otherwise unenumerable component member through a `TypeChecker`. See [Dynamic class lists](#dynamic-class-lists). |
| `tsconfig`          | discovered | The project `resolveTypes` builds from.                                                                                      |

`resolveTypes` and `tsconfig` affect `valid-template-classnames` only; the host rule has no template
member to resolve.

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

## Diagnostics: two kinds of "nearest", two kinds of wrong

Edit distance is right for typos and actively wrong for scale values, which is what the prototype
comparison surfaced. `max-h-72` is one edit from `max-h-32` and four scale steps away from it; the
value a human reaches for is `max-h-64`. So scale proximity is tried first and edit distance is the
fallback.

The message follows the same split, because the two failures are not the same mistake. `fleex` is a
misspelling. `rounded` and `max-h-72` are **real Tailwind names** that emit nothing here, and
calling those "unknown" sends the reader to the Tailwind docs to discover that the name is fine.

| Unknown       | Message                                                                                       |
| ------------- | --------------------------------------------------------------------------------------------- |
| `fleex`       | ``Unknown class `fleex` — did you mean `flex`?``                                              |
| `bg-nonsense` | ``Unknown class `bg-nonsense`.``                                                              |
| `max-h-72`    | `` `max-h-72` is off the `max-h` scale — did you mean `max-h-64`? ``                          |
| `py-14`       | `` `py-14` is off the `py` scale — did you mean `py-12`? `` (a tie goes to the smaller value) |
| `rounded`     | ``Bare `rounded` emits no CSS — did you mean `rounded-sm`?``                                  |

Every message names the failure. Member-specific runtime messages also name the next edit; the bare
`Runtime-built class list` is the fallback when the expression does not address a resolvable member.

All wording lives in [`src/lib/diagnostics.cjs`](src/lib/diagnostics.cjs), shared by both rules —
two rules reporting the same mistake in drifting words is worse than no wording at all. The rendered
member messages are asserted verbatim in the corpus; other findings are checked by message id and
data.

## Dynamic class lists

`[class.foo]` bindings, object literals, conditionals, arrays, and supported concatenations are
enumerated from the Angular expression tree whenever every branch is a literal. When an expression
remains dynamic, the useful distinction is whether its possible **whole class lists** form a closed
set. Two member-resolution tiers answer that question:

1. **Component syntax.** Resolve a direct `member` or `member()` against the component that owns the
   template. Constant properties, methods, getters, function properties, and Angular `computed`
   values resolve when every possible result is a string literal.
2. **Component types.** With `resolveTypes: true`, ask the `TypeChecker` for a member the component
   declares — or might inherit — but whose syntax was not enumerable. String-literal unions expose
   vocabularies from another module, carried by a signal, returned from an unenumerable method body,
   or inherited from a base class:

    ```ts
    readonly densityClass: Density = pickDensity() // union alias from another module
    readonly modeClass = signal<'flex' | 'hidden'>('flex') // constrained writable signal
    variantClass(i: number): 'type-body-sm' | 'type-code-sm' // annotated return
    readonly inheritedClass: 'panel' | 'badge' // declared on a base class
    ```

Both tiers preserve the same invariants: the template uses the member's actual call shape, resolution
is by declaration site rather than spelling, and every resulting literal is checked against
Tailwind, global styles, and component styles. Typed resolution is opt-in because it builds a
TypeScript program; the build is lazy, cached per tsconfig, and reused incrementally. The mechanics
live in [`member-classes.cjs`](src/lib/member-classes.cjs) and
[`type-program.cjs`](src/lib/type-program.cjs).

There is no export-name or generated-API exemption. An earlier version trusted the name of an export
without proving that the template addressed it or that it returned classes; the generated token API
returns CSS values such as `var(...)`, not class names.

### Shapes no tier resolves

| Shape                                                              | Resolvable shape                                                                  |
| ------------------------------------------------------------------ | --------------------------------------------------------------------------------- |
| A runtime value glued to a prefix or suffix: `'type-' + variant()` | A component member maps the input to whole class names.                           |
| A `@for`, `@let`, `as`, template-variable, or reference binding    | A component member accepts the value and returns every possible whole class list. |
| A property chain or index such as `obj.member()` or `list[i]`      | A direct component `member` or `member()` returns the whole class list.           |

Typing a glued runtime fragment cannot rescue it: `+` and TypeScript template literals widen the
result to `string`. Template-bound names are left unresolved because Angular resolves them ahead of
component members and the expression AST does not preserve that distinction. Chains and indexes
also remain unresolved because resolving only their root proves nothing about the final value.

Other member diagnostics identify an edit that makes the shape resolvable: narrow an effective
`string` to a string-literal union, return literals from every branch, or match the declaration's
call shape (`member` versus `member()`).

When a closed vocabulary genuinely cannot take a resolvable shape, follow the suppression convention
in [`frontend-design`](../../.agents/skills/frontend-design/SKILL.md#keep-runtime-class-vocabularies-closed).
`eslint-disable-next-line` is line-based, and Prettier can move the reported binding away from the
comment; bracket a multi-line element with `eslint-disable` and `eslint-enable` instead.

## Tests

The acceptance corpus is [`plugin.spec.cjs`](src/plugin.spec.cjs), one file tracking MAE-100's shared
corpus case by case (`R*` = reject, `A*` = accept, plus `R7`/`S1` from the comparison). It runs
under Jest in the Node environment:

```bash
npx nx test eslint-plugin-design-system
```

Every authority the corpus runs against is a fixture in [`src/fixtures/`](src/fixtures) — including
its own Tailwind config, which mirrors the _shape_ that makes the rules necessary (replaced scales
with no `DEFAULT` key) without borrowing the renderer's actual token values. A library whose tests
fail because another project changed is not standalone.

[`src/fixtures/specimen.component.html`](src/fixtures/specimen.component.html) is a committed file
the spec lints from disk, so the file-backed authorities — component stylesheet, inline `styles:`,
the template-to-component mapping — are exercised for real rather than through synthetic snippets.

## Types without a build step

The sources are `.cjs` with JSDoc types, checked by `tsc --noEmit`:

```bash
npx nx run eslint-plugin-design-system:typecheck
```

`lint` depends on it, so type errors fail `make lint`, `make sure`, and CI. There is deliberately no
compile step: ESLint requires `src/*.cjs` directly, so editing a rule applies to the very next lint
run and to the editor's language server immediately. Publishing later means emitting declarations
from the same JSDoc (`tsc --emitDeclarationOnly`), which is a packaging step rather than a
development one.

[`src/types.d.ts`](src/types.d.ts) covers the two surfaces that cannot simply be imported, and it is
worth knowing why each one is there:

- **Tailwind's internals genuinely ship no types.** `tailwindcss` declares a handful of top-level
  entry points and nothing under `lib/`. `lib/lib/generateRules` and `lib/lib/setupContextUtils` are
  internal and unavoidable — asking Tailwind's own resolver whether a class emits CSS is the design,
  and no public API answers that question. Those two are hand-declared.
- **The Angular AST types exist, and are derived rather than restated.** What cannot be imported is
  the shape ESLint actually sees: `@angular-eslint/template-parser` rewrites the AST in
  `preprocessNode` before walking it, stamping `type = node.constructor.name` on every node and
  displacing Angular's own `type` — `TmplAstBoundAttribute.type` is a numeric `BindingType` — into
  `__originalType`. The compiler's declarations therefore describe the shape _before_ the rewrite,
  and the parser's own exported node type is `{ [key: string]: any; type: any }`. So `Stamped<T, N>`
  expresses exactly that difference and every field still comes from
  `@angular/compiler`; a rename in Angular fails this build rather than
  passing silently.

That derivation is not academic. It is what caught the `[ngClass]` object-spread crash: Angular's
`LiteralMapKey` is a union and the `spread` member carries no `key`, which a hand-written node shape
had quietly papered over.

## Known limits

| Case                                                            | Status                                                                                                                      |
| --------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| Bare design tokens in `.css` files                              | **out of scope** — ESLint has no CSS language wired here; this is [MAE-109](https://linear.app/floyd-haremsa/issue/MAE-109) |
| Class applied by a parent component's stylesheet or `::ng-deep` | **would be a false positive** — none exist in the renderer today                                                            |
| Classes applied imperatively (`classList.add`)                  | **out of scope** — banned rather than validated, see [MAE-108](https://linear.app/floyd-haremsa/issue/MAE-108)              |

**Cache invalidation is the one real hazard.** Tailwind's context is built once per ESLint process
and stylesheets are cached by mtime, but ESLint's own per-file cache is keyed on the file the class
came from, not on the authorities. Editing `tailwind.config.js` or a global stylesheet does not
invalidate it, so a long-lived editor server can hold a stale verdict until the template itself
changes. A full `nx lint` run is unaffected because nx re-runs the process.

Typed resolution has a narrower version of the same hazard. It checks mtimes only for files already
in its program, while the tsconfig parse and root list are cached. A class list in a newly added file
therefore gets the untyped verdict until the ESLint process restarts — reported, never accepted
unchecked.
