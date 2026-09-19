# Design-token stylesheet checks

`design-tokens-check` validates generated files and raw color utilities, then checks CSS with
PostCSS. A TypeScript AST extracts literal Angular `Component` styles, including string arrays.
The value parser ignores comments and strings. CSS function names are case-insensitive; token names
are case-sensitive. Diagnostics name the file, line, column, rule, and a `theme(...)` replacement
when Tailwind exposes that token.

The token inventory comes from generated declarations after the stale-output check passes.
The replacement paths come from generated Tailwind tokens, including fractional spacing keys.
Tokens without a Tailwind mapping must first be exposed in the theme. The checker does not invent
paths for them.

Both `unknown-token` and `bare-design-token` apply to `--color-*`, `--foundation-*`, and `--type-*`.
Other custom properties remain component-local and are untouched. There are three access-policy
exceptions, all of which still receive the existence check:

- `src/styles/design-tokens.generated.css`
- `src/styles.css`
- `src/app/pages/design-system/`

CSS parse failures and dynamic component styles also produce diagnostics. Use literal component
styles and object metadata without spreads to allow validation. Nonliteral metadata, spreads, and
computed metadata keys that are not literal names produce diagnostics because they can hide styles.
The checker does not evaluate arbitrary TypeScript expressions.
It does not enforce token layers or validate classes inside `@apply`.

## Warning rollout

[MAE-109](https://linear.app/floyd-haremsa/issue/MAE-109) starts these stylesheet checks as warnings.
Existing generated-output and raw-color errors remain errors.

```sh
npx nx run maestro-renderer:design-tokens-check
npx nx run maestro-renderer:design-tokens-check --args=error
```

The second command reports the same findings and fails if any remain. An invalid severity fails,
rather than silently disabling validation.

Once the inventory below is empty, change the `design-tokens-check` command in
`apps/maestro-renderer/project.json` to end in `check error`. Run its tooling tests, renderer lint,
and renderer build before promoting. Remove this inventory and update `docs/testing.md` in that
change. Until then, the default check is deliberately green with warnings.

## Triaged findings

The current renderer has 16 access-policy findings, compared with the prototype's historical 21.
All 16 reference existing tokens. Locations below are relative to `apps/maestro-renderer/src/app`
at the start of this rollout. The command above reports current columns and replacement paths.

| File                                                          | Lines           | Count | Disposition                                                                                                                                                                                                   |
| ------------------------------------------------------------- | --------------- | ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `app.component.css`                                           | 61, 62          | 4     | MAE-112 moves button transitions to Tailwind utilities.                                                                                                                                                       |
| `pages/library-import/import-mosaic.component.ts`             | 99, 103         | 2     | Accepted warning debt. Keep the custom keyframes and replace the two easing references with `theme('transitionTimingFunction.emphasized')` and `theme('transitionTimingFunction.standard')` before promotion. |
| `shared/components/progress-bar/progress-bar.component.css`   | 4, 5, 6, 10, 11 | 7     | Accepted warning debt. Keep custom progress transitions. Replace duration and easing references with the diagnostic's `transitionDuration.*` and `transitionTimingFunction.*` theme paths before promotion.   |
| `shared/components/progress-ring/progress-ring.component.css` | 2, 3, 13        | 3     | Accepted warning debt. Keep SVG and spin behavior. Replace duration and easing references with the diagnostic's theme paths before promotion.                                                                 |

MAE-112 explicitly preserves the progress and animation exceptions. It clears only the four app
findings; the other twelve require targeted token substitutions and visual verification before
error promotion. No file suppression hides this debt.

The first scan also found ten unknown letter-spacing references in generated classes and global
styles. The generator now converts camelCase token paths to kebab-case for declarations, aliases,
and its TypeScript helpers using the same normalization function. Regenerated outputs resolve all
ten references. The original semantic values now apply instead of an unresolved CSS custom property.
