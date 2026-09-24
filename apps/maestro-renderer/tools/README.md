# Design-token checks

`design-tokens-check` validates generated output, contrast pairs, raw color utilities, and
stylesheet token references. It prints every finding in red and fails if it finds any.

Product styles must access design tokens through Tailwind v4's theme CSS variables. The checker
allows declared semantic `--color-*` variables and rejects unknown color variables or direct
`--foundation-*` and `--type-*` references. Direct foundation and type references are allowed only
in:

- `src/styles/design-tokens.generated.css`
- `src/styles.css`
- `src/app/pages/design-system/`

Angular component styles must be literals so the checker can inspect them. It does not validate
classes inside `@apply` or enforce the semantic and foundation token layers.

Contrast pairs use the project's 3.5:1 minimum. This is not WCAG AA compliance for normal text,
which requires 4.5:1.

```sh
pnpm exec nx run maestro-renderer:design-tokens-check
```
