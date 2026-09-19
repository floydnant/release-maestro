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

## Enforcement

`design-tokens-check` reports stylesheet findings in red and exits with an error if any remain.
Generated-output, contrast, and raw-color violations fail the same check.
Contrast pairs must meet the project's 3:1 minimum. This threshold does not assert WCAG AA
compliance for normal text, which requires 4.5:1.

```sh
npx nx run maestro-renderer:design-tokens-check
```

The first scan also found ten unknown letter-spacing references in generated classes and global
styles. The generator now converts camelCase token paths to kebab-case for declarations, aliases,
and its TypeScript helpers using the same normalization function. Regenerated outputs resolve all
ten references. The original semantic values now apply instead of an unresolved CSS custom property.
