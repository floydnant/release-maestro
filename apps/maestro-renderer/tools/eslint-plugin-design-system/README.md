# MAE-106 prototype — Angular-template-aware ESLint class validation

Prototype for [MAE-100](https://linear.app/floyd-haremsa/issue/MAE-100). Isolated to this branch; it
is evidence for a comparison, not a proposal to adopt.

> **Provenance caveat.** Linear was unreachable from the implementing session, so the requirements
> were taken from the handoff document (`release-maestro-mae-100-prototype-agent-handoff.md`), which
> enumerates the invariants: validate styling-class _existence_, honour the `descriptor | utilities`
> pipe convention, cover the dynamic class surfaces, keep no hand-maintained allowlist, and do not
> enforce descriptor purity. The corpus below is derived from those invariants plus every class
> surface the renderer actually uses. Cases from MAE-100's own shared corpus that are not represented
> here have not been evaluated.

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

Everything left of a `|` in a class list is a semantic descriptor and is never checked.

## Corpus results

Executable as the rule test suite: `npx nx run maestro-renderer:eslint-rules-test`
(`apps/maestro-renderer/tools/eslint-plugin-design-system/plugin.node-test.cjs`).

| #   | Case                                                                              | Result                                                                               |
| --- | --------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| 1   | Static utility (`flex items-center gap-3`)                                        | pass                                                                                 |
| 2   | Arbitrary value (`w-[130px]`, `bg-[color-mix(…)]`)                                | pass                                                                                 |
| 3   | Variants (`hover:`, `group-hover:`, `@lg:`)                                       | pass                                                                                 |
| 4   | Tailwind-plugin utilities (`glass`, `wrap-nicely`, `child-focus-ring`)            | pass                                                                                 |
| 5   | Variant markers (`group`, `peer`, `group/row`)                                    | pass                                                                                 |
| 6   | Global authored classes (`btn-nkd-neutral`, `badge`, `panel`)                     | pass                                                                                 |
| 7   | Generated token classes (`type-body-sm`, `type-code-sm`)                          | pass                                                                                 |
| 8   | Component-scoped classes, incl. inline `styles:`                                  | pass                                                                                 |
| 9   | Component-scoped class used by a _different_ component                            | fail (reported) — desired                                                            |
| 10  | Pipe convention: descriptor exempt, utilities checked                             | pass                                                                                 |
| 11  | Unknown static class (`type-code-sl`, `bg-nonsense`)                              | fail (reported) — desired                                                            |
| 12  | `[class.rounded-l-full]` / `[class.rounded-nope]`                                 | pass / fail (reported)                                                               |
| 13  | `[ngClass]` object keys, single and multi-class                                   | pass / fail (reported)                                                               |
| 14  | `[class]` conditional (`cond ? 'flex' : 'hiddenn'`)                               | pass / fail (reported)                                                               |
| 15  | `[class]` concatenation (`'badge border ' + fn()`)                                | partial — literal tokens checked, the fragment touching the runtime value is skipped |
| 16  | `routerLinkActive="active-link"`                                                  | pass / fail (reported) for a typo                                                    |
| 17  | Static `ngClass="flex gap-2"`                                                     | pass                                                                                 |
| 18  | Host metadata `host: { class: … }` in `@Component`/`@Directive`                   | pass / fail (reported)                                                               |
| 19  | Inline templates in `.ts`                                                         | pass (processor-extracted, same rule)                                                |
| 20  | Fully dynamic class list (`[class]="fn()"`, `[ngClass]="map"`, `class="{{ x }}"`) | **unsupported** — silently skipped, or reported with `reportDynamic: true`           |
| 21  | Runtime-built prefix (`'type-' + token`)                                          | **unsupported** — the fragment is skipped                                            |
| 22  | Class applied by a parent component's stylesheet or `::ng-deep`                   | **unsupported** — would report a false positive; none exist in the renderer today    |
| 23  | Descriptor-only class list without a pipe (`class="favicon"`)                     | **fails by design** — see cost below                                                 |

## What it found in the renderer

The rule found 15 real defects on a repository that `eslint`, `tsc`, and the existing
`design-tokens-check` all passed. All were fixed in this branch:

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

**Descriptors not marked with the pipe.** `app-shell`, `track-control`, `track-seeker`, `favicon`,
`mosaic-cell`, `settings-item`, `progress-bg` — all semantic descriptors with no CSS anywhere. They
now carry the `|` separator.

## Cost of the convention

A descriptor-only class list has to be written `class="favicon |"`. There is no way to tell a
descriptor from a typo by shape, so the pipe is the only signal the rule can trust, and a trailing
pipe reads awkwardly. This is the sharpest ergonomic cost of the approach and MAE-104 should decide
whether the convention absorbs it or the rule needs another signal.

## Runtime

macOS, warm `node_modules`, full renderer surface (`src/**/*.ts` + `src/**/*.html`), median of 3:

| Run                                           | With the rules | Without |
| --------------------------------------------- | -------------- | ------- |
| `eslint` direct, first run (cold module load) | 4.28 s         | —       |
| `eslint` direct, subsequent runs              | 3.57 s         | 3.46 s  |
| `nx lint maestro-renderer --skip-nx-cache`    | 6.02 s         | —       |
| `nx lint maestro-renderer` (nx cache hit)     | 5.53 s         | —       |

Roughly 0.1–0.2 s over the whole project. Tailwind's context is built once per ESLint process and
memoised; stylesheets are cached by mtime.

## Limits and open questions

- **Cross-component styling is a false-positive risk.** The renderer has none today, but a class
  applied by a parent stylesheet or `::ng-deep` would be reported. Widening the authority to _all_
  component stylesheets would remove the risk and most of the value.
- **The `styleUrl`/`styles` extraction is a regex**, not the TypeScript AST — enough for the styles,
  cheap for every template, but not exact.
- **Descriptor purity is not enforced** and must not be: `progress-segment` and `.track` are also
  runtime hooks (component CSS, a DOM query). This prototype only asks whether a styling class
  exists.
- **Editor feedback is immediate** — this is an ESLint rule, so violations surface as you type, which
  neither a build-time scanner nor a separate CLI can offer.
- The rule holds no design-system knowledge of its own: renaming a token or a global class updates
  the authority automatically.
