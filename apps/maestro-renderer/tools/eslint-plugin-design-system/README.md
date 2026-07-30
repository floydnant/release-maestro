# MAE-106 prototype — Angular-template-aware ESLint class validation

Prototype for [MAE-100](https://linear.app/floyd-haremsa/issue/MAE-100). Isolated to this branch; it
is evidence for a comparison, not a proposal to adopt.

## What it does

Two rules over one shared authority:

| Rule                                      | Surface                                                                                                                                                             |
| ----------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `design-system/valid-template-classnames` | `class`, `ngClass`, `routerLinkActive`, `[class]`, `[ngClass]`, `[class.foo]`, in `.html` files and in inline templates (via the Angular inline-template processor) |
| `design-system/valid-host-classnames`     | `@Component`/`@Directive` `host: { class: '…' }`                                                                                                                    |

A class is known when **any** of these holds:

1. **Tailwind generates CSS for it.** The rule calls Tailwind's own `generateRules` against
   `tailwind.config.js`, so variants, arbitrary values, container queries and the config's plugin
   utilities (`glass`, `wrap-nicely`, `child-focus-ring`) are covered without restating any of them.
   The only literal list in the plugin is `group`/`peer` (+ named forms), which are variant markers
   that legitimately emit no CSS.
2. **An authored stylesheet declares it.** Class selectors are harvested with PostCSS from
   `src/styles.css` and everything it `@import`s — which is how `.type-*` from
   `design-tokens.generated.css` and `.btn-*`, `.badge`, `.panel` become known.
3. **The component's own styles declare it**, resolved from the component's `styleUrl`/`styleUrls`
   and inline `styles:`. Component-scoped classes are known _only_ inside their own component.

Everything left of a `|` in a class list is a semantic descriptor and is never checked. The list
shape is enforced: zero or one descriptor, at most one pipe.

Two further checks ride along on the same tokens:

- **Nearest-name suggestion.** Candidates come from the same three authorities, so a suggested name
  is always a name that would pass. It is reported, never applied, and is withheld when the best
  match is far away or when two candidates tie — `type-code-sl` → `type-code-sm`, `fleex` → `flex`,
  but `bg-nonsense` gets no guess.
- **Bare design-token variables inside arbitrary values.** `bg-[color-mix(…var(--color-…)…)]` is a
  structurally valid utility hiding an unchecked token reference, so `var(--color-*)`,
  `var(--foundation-*)` and `var(--type-*)` are rejected there in favour of `theme(…)`.
  Component-local custom properties (`--progress-width`) are not design tokens and are untouched.
- **Theme paths inside arbitrary values.** `theme(...)` is the sanctioned replacement, but Tailwind
  resolves it only when the stylesheet is compiled — a misspelled path is a build error, not an
  editor diagnostic. The rule resolves the path against the same config, so
  `theme(colors.status.info.background)` is rejected in favour of `theme(colors.status.info-background)`.

## Corpus results

Executable as the rule test suite: `npx nx run maestro-renderer:eslint-rules-test`
([`plugin.node-test.cjs`](plugin.node-test.cjs)). Rows follow MAE-100's shared acceptance corpus.

### Must reject or report unsupported

| Case                                                        | Result                                                          |
| ----------------------------------------------------------- | --------------------------------------------------------------- |
| Unknown generated class `type-code-sl`                      | **reject** — exact token, suggests `type-code-sm`               |
| Unknown ordinary utility `fleex`                            | **reject** — suggests `flex`                                    |
| Authored class absent from owning component and global CSS  | **reject** — `scoped-only` outside its component                |
| Empty descriptor (`class="\| flex"`)                        | **reject** — `emptyDescriptor`                                  |
| Multiple descriptors (`class="sidebar rail \| flex"`)       | **reject** — `multipleDescriptors`                              |
| Multiple pipes (`class="sidebar \| flex \| hidden"`)        | **reject** — `multiplePipes`                                    |
| Unresolved construction `[class]="fn()"`, `[ngClass]="map"` | **reject** as an explicit unsupported case (`dynamicClassList`) |
| Runtime-built prefix `'type-' + token`                      | **reject** — `dynamicClassList` + `partialClass` on `type-`     |
| Interpolated list `class="{{ x }}"`                         | **reject** — `dynamicClassList`                                 |
| Bare design-token variable in a Tailwind arbitrary value    | **reject** — `bareTokenVariable`, underlining the `var(…)`      |
| Bare design-token variable in a product `.css` file         | **unsupported** — see below                                     |

### Must accept

| Case                                                                                                                                 | Result                                      |
| ------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------- |
| Valid utilities, modifiers, variants (`hover:`, `group-hover:`, `@lg:`)                                                              | pass                                        |
| Variant markers (`group`, `peer`, `group/row`)                                                                                       | pass                                        |
| Valid arbitrary layout values (`w-[130px]`, `bg-[color-mix(…)]`)                                                                     | pass                                        |
| Generated typography classes (`type-code-sm`, `type-body-sm`)                                                                        | pass                                        |
| Global authored classes (`btn-nkd-neutral`, `badge`, `panel`)                                                                        | pass                                        |
| Tailwind-plugin utilities (`glass`, `wrap-nicely`, `child-focus-ring`)                                                               | pass                                        |
| Owning component's scoped CSS, including inline `styles:`                                                                            | pass                                        |
| Static list with no descriptor and no pipe                                                                                           | pass                                        |
| Exactly one optional descriptor before `\|`                                                                                          | pass                                        |
| Statically enumerable bindings: `[class.foo]`, `[ngClass]` object keys, `[class]` conditionals, `routerLinkActive`, static `ngClass` | pass                                        |
| Component host classes                                                                                                               | pass                                        |
| Inline templates in `.ts`                                                                                                            | pass (processor-extracted, same rule)       |
| Typed/generated API for dynamic token selection                                                                                      | pass via a narrow suppression, not silently |
| Component-local custom property (`w-[var(--progress-width)]`)                                                                        | pass                                        |

### Known gaps

| Case                                                            | Result                                                                                                      |
| --------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| Bare design tokens in `.css` files                              | **unsupported** — ESLint has no CSS language wired here; this stays with the existing `design-tokens-check` |
| Class vocabularies defined as string literals in component TS   | **unsupported** — closed but invisible to both rules; needs a suppression                                   |
| Class applied by a parent component's stylesheet or `::ng-deep` | **unsupported** — would be a false positive; none exist in the renderer today                               |
| Descriptor-only class list without a pipe (`class="favicon"`)   | **rejected by design** — see cost below                                                                     |

## What it found in the renderer

The rule found 19 real defects on a repository that `eslint`, `tsc`, and the existing
`design-tokens-check` all passed. All were fixed in this branch.

**Classes that silently produced no CSS.** The Tailwind theme _replaces_ `spacing`, `borderRadius`
and `opacity` rather than extending them, so default-scale utilities are dead:

| Was           | Now                         | File                                                                                                             |
| ------------- | --------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| `max-h-72` ×2 | `max-h-64`                  | `settings/debug/debug.component.html`                                                                            |
| `max-h-44`    | `max-h-52`                  | `settings/debug/debug.component.html`                                                                            |
| `min-h-36`    | `min-h-32`                  | `settings/debug/debug.component.html`                                                                            |
| `py-14`       | `py-12`                     | `shared/components/folder-list/folder-list.component.html`                                                       |
| `opacity-80`  | `opacity-70`                | `shared/components/folder-list/folder-list.component.html`                                                       |
| `rounded` ×2  | `rounded-sm` (same 0.25rem) | `settings/library/library-settings.component.html`, `shared/components/progress-bar/progress-bar.component.html` |

Each replacement is the nearest existing token, so these edits _start_ applying a style that was
never applied before. `rounded` → `rounded-sm` is exactly equivalent; the others are a judgement
call and worth a design review.

**Bare design tokens hidden in arbitrary values.** Four `bg-[color-mix(in_srgb,var(--color-…)…)]`
utilities in `folder-list.component.html` now read `theme(colors.…)`. Compiling both forms through
the real Tailwind pipeline emits byte-identical CSS, so this migration is behaviour-preserving.

Writing that migration is also what surfaced the `theme(...)` path check: the first attempt used
`theme(colors.status.info.background)`, which every rule accepted and only `nx build` rejected. The
rule now resolves theme paths itself, so that class of mistake is caught in the editor.

**Descriptors not marked with the pipe.** `app-shell`, `track-control`, `track-seeker`, `favicon`,
`mosaic-cell`, `settings-item`, `progress-bg` — all semantic descriptors with no CSS anywhere. They
now carry the `|` separator.

## Cost of the convention

A descriptor-only class list has to be written `class="favicon |"`. There is no way to tell a
descriptor from a typo by shape, so the pipe is the only signal the rule can trust, and a trailing
pipe reads awkwardly. This is the sharpest ergonomic cost of the approach and MAE-104 should decide
whether the convention absorbs it or the rule needs another signal.

## Suppressing the exceptional cases

Three sites in the renderer build a class list at runtime from a closed vocabulary the rule cannot
see. Each carries a narrow, explained suppression rather than a configured ignore pattern:

- `design-system.component.html` — `'type-' + token`, where `token` comes from the generated
  `typographyVariantIdentifiers`. This is MAE-100's "typed/generated API" case.
- `debug.component.html` ×2 — `workerHealthClass()` and `scanPhaseClass()` return one of a handful of
  fixed literals defined in the component TypeScript.

One friction point worth recording: `eslint-disable-next-line` is line-based, and Prettier's
attribute wrapping can move the reported line away from the comment. A multi-line binding therefore
needs a `eslint-disable` / `eslint-enable` pair around the element instead.

## Diagnostics

Errors carry the exact token range, so editors underline `type-code-sl` and not the whole attribute —
including inside `[ngClass]` object keys and `[class]` string concatenations, where the offset is
computed from the Angular expression AST. Severity is ordinary ESLint configuration, so the rules can
be set to `warn` while a migration is in flight. There is no autofix by design.

## Runtime and cache behaviour

macOS, warm `node_modules`, full renderer surface (`src/**/*.ts` + `src/**/*.html`), median of 3:

| Run                                        | With the rules | Without |
| ------------------------------------------ | -------------- | ------- |
| `eslint` direct, no cache                  | 3.79 s         | 3.63 s  |
| `eslint --cache`, cold cache               | 3.63 s         | —       |
| `eslint --cache`, warm cache               | 1.01 s         | —       |
| `nx lint maestro-renderer --skip-nx-cache` | 5.94 s         | —       |
| `nx lint maestro-renderer` (nx cache hit)  | 5.79 s         | —       |

Roughly 0.15 s over the whole project — inside run-to-run noise. ESLint's own file cache works
normally, which is what matters for editor latency: a warm re-lint is ~1 s for the project and
effectively instant for a single open file.

Two internal caches make that possible: Tailwind's context is built once per ESLint process and
memoised per config path, and the 10.8k-entry class list used for suggestions is built lazily on the
first failure. Stylesheets are parsed once and cached by mtime.

**Cache invalidation is the one real hazard.** Both caches are keyed on the file the class came from,
not on the authorities. Editing `tailwind.config.js` or a global stylesheet does not invalidate
ESLint's per-file cache, so a long-lived editor server can hold a stale verdict until the template
itself changes. A full `nx lint` run is unaffected because nx re-runs the process.

## Limits and open questions

- **Cross-component styling is a false-positive risk.** The renderer has none today, but a class
  applied by a parent stylesheet or `::ng-deep` would be reported. Widening the authority to _all_
  component stylesheets would remove the risk and most of the value.
- **The `styleUrl`/`styles` extraction is a regex**, not the TypeScript AST — enough for the styles,
  cheap for every template, but not exact.
- **Product `.css` files are out of reach.** An ESLint rule sees templates and TypeScript; the CSS
  half of MAE-100's design-token contract needs Stylelint or the existing `design-tokens-check`.
- **Descriptor purity is not enforced** and must not be: `progress-segment` and `.track` are also
  runtime hooks (component CSS, a DOM query). This prototype only asks whether a styling class
  exists.
- **Editor feedback is immediate** — this is an ESLint rule, so violations surface as you type, which
  neither a build-time scanner nor a separate CLI can offer.
- The rule holds no design-system knowledge of its own: renaming a token or a global class updates
  the authority automatically.
