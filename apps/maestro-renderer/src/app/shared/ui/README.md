# Shared UI

Standard renderer controls use Spartan UI. `@spartan-ng/brain` supplies the interaction behavior;
this directory contains editable Helm source adapted to Release Maestro's design system. Imports
keep the canonical family names through the root TypeScript alias:

```ts
import { HlmButton } from '@spartan-ng/helm/button'
import { HlmInput } from '@spartan-ng/helm/input'
```

Use the exported directives and components directly in product templates:

```html
<button hlmBtn>Continue</button>
<input hlmInput aria-label="Search albums" />
<span hlmBadge variant="secondary">Announced today</span>
<section hlmCard><!-- Product content --></section>
```

Shared defaults use the existing generated semantic tokens, system typography and desktop
interaction states. Adjust those defaults here when several callers need the same change. Product
templates use Tailwind for layout and domain-specific composition.

Grid row actions use `tabindex="-1"` so the grid retains its keyboard focus model. Helm preserves
the native static attribute and exposes `[tabindex]` for dynamic values. Disabled buttons receive
`-1`; enabling restores the caller value. Use the directive input for a dynamic tabindex because
Brain's host binding can overwrite `[attr.tabindex]`.

Inputs, textareas and native selects accept `aria-describedby`; Brain combines those caller IDs
with descriptions registered by the enclosing Field. Native selects forward the IDs to their inner
`select`. The dialog service accepts component classes and `TemplateRef`; a template's `let-dialog`
receives the supplied context and `close(result)` action.

Product components own music data, scan state, recovery actions and navigation. Their fetched
viewport windows and query/range selection remain governed by
[ADR 0004](../../../../../../docs/adr/0004-browse-queries-are-windowed-and-selections-carry-a-query.md).
Route tabs remain links with the history behavior in
[ADR 0006](../../../../../../docs/adr/0006-only-route-changes-are-history-steps.md).

## Add or update a component

The Brain runtime and copied Helm source start at Spartan 1.5.0. Check the root `package.json` and
[upstream.json](upstream.json) for the versions currently in use.

1. Find the component in the matching
   [tagged Helm source](https://github.com/spartan-ng/spartan/tree/v1.5.0/libs/helm). Copy its source
   and local dependencies into this directory, preserving canonical exports. Record the upstream
   tag, original paths and local adaptations in `upstream.json`. Retain the copyright and
   [MIT license notice](LICENSE).
2. Adapt component defaults to the generated semantic tokens, typography, spacing, radius, focus,
   disabled and motion states. The central
   [Spartan styles](../../../styles/spartan.css) supply shared state variants and animation
   behavior. The Spartan CLI and global Tailwind preset are not part of this setup; they can rewrite
   dependencies or redefine existing utilities. Add only dependencies the copied component actually
   imports, with versions compatible with the current workspace.
3. Keep Angular signal inputs/outputs and OnPush for owned components. Brain handles reusable
   interaction behavior; product components own domain state. Existing icon mappings can supply icons
   without changing the project's ng-icons version to match generator defaults.
4. Keep copied-code selector or class-merging exceptions scoped to this directory. Enumerate the
   static class vocabulary and validate it against the renderer's Tailwind authority. Product
   templates and host classes keep the existing class-list rules. A library helper returning `string`
   does not justify disabling validation across the renderer.
5. Add a representative specimen for a new component, including the relevant disabled, loading or
   error state. Verify renderer lint and build, then interaction checks appropriate to the component
   under [the testing guide](../../../../../../docs/testing.md). For overlays, check keyboard
   opening, Escape, focus containment/restoration and nested overlays in Electron. Completion means
   the component uses the shared token defaults and those relevant checks pass.

## Review upgrades

Compare upstream changes against the recorded local adaptations, then apply the fixes while keeping
the token defaults. Automated Helm migrations overwrite customized files, so source review is the
update workflow. Update Brain and the copied-source provenance together when their compatibility
requires it. Recheck components affected by the upstream change instead of rewriting product callers.
