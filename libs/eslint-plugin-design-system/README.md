# eslint-plugin-design-system

Class validation for the renderer: a styling class that resolves to no CSS is an error, not a
silent no-op.

Selected in [MAE-100](https://linear.app/floyd-haremsa/issue/MAE-100) out of three prototypes. The
convention it enforces is documented for humans and agents in
[`frontend-design`](../../.agents/skills/frontend-design/SKILL.md); this file is about how the rules
work and where they stop.

The library knows nothing about Release Maestro's design system, or any other. Every authority — the
Tailwind config and the global stylesheets — arrives as a rule option, which is what makes it a
library rather than a folder of scripts, and what would make publishing it a packaging question
rather than a rewrite.

## The two rules

| Rule                                      | Surface                                                                                                                                                             |
| ----------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `design-system/valid-template-classnames` | `class`, `ngClass`, `routerLinkActive`, `[class]`, `[ngClass]`, `[class.foo]`, in `.html` files and in inline templates (via the Angular inline-template processor) |
| `design-system/valid-host-classnames`     | `@Component`/`@Directive` `host: { class: '…' }` and `host: { '[class.foo]': … }`                                                                                   |

Both are registered at `error` in `apps/maestro-renderer/eslint.config.mjs`:

```js
const designSystem = createRequire(import.meta.url)('../../libs/eslint-plugin-design-system/src/index.cjs')

const classValidationOptions = {
    tailwindConfig: join(projectRoot, 'tailwind.config.js'),
    globalStylesheets: [join(projectRoot, 'src/styles.css')],
}
```

The relative path is because the workspace does not use npm workspaces — a published consumer would
write the package name.

| Option              | Default | Meaning                                                                                          |
| ------------------- | ------- | ------------------------------------------------------------------------------------------------ |
| `tailwindConfig`    | —       | Required. The config whose utilities and theme paths are the authority.                          |
| `globalStylesheets` | `[]`    | Stylesheets whose authored classes count as known everywhere.                                    |
| `reportDynamic`     | `true`  | Report class lists that cannot be enumerated. Off silences the whole category.                   |
| `resolveTypes`      | `false` | Resolve a component member through a `TypeChecker` when its syntax is not enumerable. See below. |
| `tsconfig`          | —       | The project `resolveTypes` builds from. Discovered from the component file when unset.           |

`resolveTypes` and `tsconfig` are read by `valid-template-classnames` only; the host rule has no
template member to resolve.

Registration is per-project on purpose: the renderer's authorities are the renderer's, so putting
this at the workspace root would lint `maestro-electron` against a design system it does not use.

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

Every message names its own failure and stops. The findings with nothing to fix in the class list
itself are the exception, and say what to do instead:

```
Runtime-built class list — enumerate the classes, or suppress with a reason.
`type-` is glued to a runtime value — suppress with a reason if the vocabulary is closed.
```

That first one is the fallback, and it is a **dead end for the reader**: it names no expression, no
member, and no edit, so the only move it suggests is `eslint-disable`. Wherever the rule knows more
than "runtime-built", it says so instead — which is what keeps a suppression from being the path of
least resistance for a human or an agent.

| The binding                      | What it is told                                                                                               |
| -------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| `[class]="workerHealthClass()"`  | `` `workerHealthClass` is not a member of `AppComponent` — … ``                                               |
| `[class]="libraryScanPercent()"` | `` `libraryScanPercent` is typed `number`, which is not a closed set of class names — narrow it … ``          |
| `[class]="statusClass"`          | `` `statusClass` is a method or a signal, but the template reads it as a property — write `statusClass()`. `` |
| `[class]="listClass()"`          | `` `listClass` is a plain value, but the template reads it as a call — write `listClass`. ``                  |
| `[class]="badgeClass().length"`  | `A class list reached through a property chain or an index is not resolvable — …`                             |
| `@for (c of rows) [class]="c"`   | `` `c` is bound by the template, not by `AppComponent` — … ``                                                 |
| a member no tier could enumerate | `` `x` is a member of `C` but its class list is not enumerable from that file — … ``                          |

All wording lives in [`src/lib/diagnostics.cjs`](src/lib/diagnostics.cjs), shared by both rules —
two rules reporting the same mistake in drifting words is worse than no wording at all. The rendered
text is asserted verbatim in the corpus, not just the message ids.

## Dynamic class lists

Statically enumerable bindings are validated like any other class list: `[class.foo]`, `[ngClass]`
object keys, `[class]` conditionals and concatenations. What cannot be enumerated is reported rather
than quietly accepted — moving a class into a binding is not a bypass.

Real applications need some dynamism, though, and a rule whose only answer to it is "suppress this"
trains everyone to suppress. So the interesting question is not whether a binding is dynamic but
whether the set of classes it can produce is **closed**. Two tiers try to answer that, in cost order,
and whichever fails says why.

### A closed vocabulary in the component

The first tier costs nothing: the expression names a member of the component that owns the template,
and that member returns nothing but string literals. `[class]="'badge ' + statusClass(s)"` is checked
against every branch `statusClass` can return.

The resolution is in [`src/lib/member-classes.cjs`](src/lib/member-classes.cjs), and two properties
are what make it an acceptance path rather than a bypass:

- **Resolved by declaration site, not by spelling.** The member is looked up on the component the
  template already maps to. A same-named helper somewhere else in the app is not a match, and a name
  the template itself binds — a `@for` item, `@let`, an `as` alias, a `#ref` — never resolves against
  the component at all.
- **The answer is the literal strings**, which go through the same three authorities as any
  hand-written class list. A resolved member carrying `fleex` is reported exactly like a template
  carrying `fleex`. Nothing is trusted for where it came from.

This tier reads one file's syntax and nothing else, so it gives up on a branch that is not a literal,
`signal()` (writable, so its initial value is not what renders), a `computed` that is not Angular's,
a call chain past the resolved member, a member whose call shape disagrees with its declaration, and
a name declared by two components in the same file. It gives up **with a reason** — see the message
table above — and the tier below picks up several of those cases.

### The same vocabulary, through the type checker

`resolveTypes: true` adds a second tier: when a member the component genuinely declares is not
enumerable from its syntax, the member's **type** is asked instead. A union of string literals is a
closed vocabulary however it was written, so this resolves what a parse cannot see —

```ts
readonly densityClass: Density = pickDensity()      // union alias from another module
readonly modeClass = signal<'flex' | 'hidden'>('flex')  // writable, but the type constrains every set
variantClass(i: number): 'type-body-sm' | 'type-code-sm'  // annotated return, unenumerable body
readonly inheritedClass: 'panel' | 'badge'          // declared on a base class
```

— and reports the type standing in the way when it is not closed: `` `x` is typed `string`, which is
not a closed set of class names ``. Nothing else loosens. The literals are still validated against
the same three authorities, the call shape still has to agree, a template-bound name still never
resolves, and a chain still resolves nothing.

It is off by default because it builds a TypeScript program, which the plugin should not impose on a
consumer that has not asked for one. Two things keep it affordable, both measured on the renderer's
61-root program (540 files) and implemented in
[`src/lib/type-program.cjs`](src/lib/type-program.cjs):

- **Lazy.** Nothing is built until a class binding names a member the syntactic tier could not
  enumerate. A template with no dynamic class list never constructs a program. In practice the
  renderer's own lint does not build one at all — its single unresolvable binding is a template-bound
  name, which is decided before the tier is reached.
- **Reused.** ~1.1s for the first build, ~80ms per rebuild after an edit, because the compiler host
  caches source files by mtime and each rebuild is handed the previous program. In an editor, where
  ESLint is a long-lived server, that first second is paid once per session. (Deliberately not
  `ts.createWatchProgram`: same incremental cost, but it installs file watchers and ESLint gives a
  rule no teardown hook to close them with.)

`tsconfig` names the project to build from; without it the nearest tsconfig that actually lists the
component file is discovered by walking up from it.

**There is still no exemption for typed or generated APIs**, and the difference is the point. An
earlier version accepted any expression whose root identifier matched an export of a configured
generated module. That was not a type-based check: it read export _names_ out of a file, never
resolved the template's member to that export, and never established that the call returns class
names — so a same-named component helper, or any chain hanging off an accepted root, sailed through.
It also had no real consumer, since the generated token module exports values (`semanticColor`
returns a `var(...)` string) rather than class names. A check that cannot fail is worse than no
check, so it is gone.

### What neither tier reaches

**Concatenation.** `'type-' + token` is `string` however `token` is typed — `+` and template
literals both widen — so no amount of type information resolves a prefix glued to a runtime value.
A member returning whole class names does.

**A name the template binds.** `@for` items, `@let`, `as` aliases and `#ref`s are resolved by Angular
ahead of the component's members, and the expression AST does not mark which is which. A name the
template binds anywhere is never resolved against the component — over-broad on purpose, and the
cost of being wrong is only that an expression stays unresolved.

**Anything reached through a chain or an index.** `obj.member()`, `member().foo`, `list[i]`: the rule
cannot see what the rest of the chain does to the value, so the root resolving proves nothing.

The supported answer for a genuinely closed vocabulary that lands in one of those is a narrow
`eslint-disable-next-line` with a reason. One site in the renderer has one — `'type-' + token` in the
design-system specimen, which is both of the first two at once. Note that `eslint-disable-next-line`
is line-based and Prettier's attribute wrapping can move the reported line away from the comment; a
multi-line binding needs an `eslint-disable` / `eslint-enable` pair around the element instead.

## Tests

The acceptance corpus is [`plugin.spec.cjs`](plugin.spec.cjs), one file tracking MAE-100's shared
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
| Class vocabularies defined as string literals in component TS   | **supported** — resolved from the component's syntax, or from its types under `resolveTypes`                                |
| A prefix concatenated onto a runtime value (`'type-' + token`)  | **unsupported** — `+` widens to `string` whatever the operand is typed as; needs a member returning whole class names       |
| Class applied by a parent component's stylesheet or `::ng-deep` | **would be a false positive** — none exist in the renderer today                                                            |
| Classes applied imperatively (`classList.add`)                  | **out of scope** — banned rather than validated, see [MAE-108](https://linear.app/floyd-haremsa/issue/MAE-108)              |

**Cache invalidation is the one real hazard.** Tailwind's context is built once per ESLint process
and stylesheets are cached by mtime, but ESLint's own per-file cache is keyed on the file the class
came from, not on the authorities. Editing `tailwind.config.js` or a global stylesheet does not
invalidate it, so a long-lived editor server can hold a stale verdict until the template itself
changes. A full `nx lint` run is unaffected because nx re-runs the process.

`resolveTypes` has a narrower version of the same hazard. Its program rebuilds when any project file
it already holds changes on disk, but a file _added_ since the tsconfig was parsed is not in it — the
parse is cached by the tsconfig's own mtime. A brand-new component therefore resolves to nothing
rather than to something wrong, which degrades to the pre-`resolveTypes` verdict until the process
restarts.

Cost over the whole renderer is roughly 0.15 s of a ~3.7 s lint — inside run-to-run noise. ESLint's
file cache works normally, so a warm re-lint is ~1 s for the project and effectively instant for a
single open file.
