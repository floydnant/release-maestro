# Design-token enforcement prototype

This directory is the source of truth for renderer design tokens. Run `make design-tokens` after
changing a token and commit the generated artifacts. `make design-tokens-check` detects stale
generated files, raw foundation-colour utilities, and unknown design-token custom properties.

## Approaches evaluated

### Tailwind theme keys

The generated Tailwind theme makes semantic utilities such as `text-content-primary` discoverable
and rejects nonexistent static classes by producing no CSS for them. This is the preferred approach
in Angular templates. It does not cover component stylesheets or dynamically constructed values.

### TypeScript identifier unions

The generated `SemanticColorIdentifier` union and `semanticColor()` helper make dynamic component
inputs type-safe. This is the preferred approach when a colour is selected in TypeScript rather than
expressed as a static utility class.

### Source validation

The check command scans renderer source for `var(--color-…)`, `var(--foundation-…)`, and
`var(--type-…)` references and compares them with generated declarations. It catches misspellings in
component CSS and inline styles while leaving component-local custom properties alone.

## Verdict

Keep all three checks: each protects a different consumption path without requiring a component
refactor. Prefer semantic Tailwind utilities for ordinary templates, typed identifiers for dynamic
values, and direct foundation variables only when implementing shared primitives or the design-system
specimen.

This prototype can be absorbed as the permanent enforcement once the conventions have proved useful;
the specimen route remains development-only.
