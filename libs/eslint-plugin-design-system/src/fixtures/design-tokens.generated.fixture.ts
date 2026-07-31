/*
 * Fixture standing in for `src/app/shared/design-tokens.generated.ts`. Not application code.
 *
 * The real generated module exports token *values* (`semanticColor` returns a `var(...)` string),
 * so today no renderer template selects a class name through it. This fixture carries the shape
 * MAE-100's "typed/generated API for legitimate dynamic token selection" case describes, so the
 * acceptance path is covered by the corpus rather than by whatever the generator happens to emit.
 */
export const typographyVariantIdentifiers = ['body-md', 'code-sm'] as const

export type TypographyVariantIdentifier = (typeof typographyVariantIdentifiers)[number]

export const typographyClass = (variant: TypographyVariantIdentifier): string => `type-${variant}`
