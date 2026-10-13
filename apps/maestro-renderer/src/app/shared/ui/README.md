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

Every single-line control (buttons, icon buttons, inputs, select triggers, and menu and select
items) has one fixed height, `--foundation-size-control-sm`, so controls side by side line up
regardless of border or type. Size them by height, never by vertical padding plus line height: that is how bordered and borderless
controls drift apart by a pixel or two. `xs`/`icon-xs` serve title-bar and table chrome, `lg`/`icon-lg`
standalone actions that are meant to stand out. Textareas keep native sizing. A click target that has no button
appearance uses `variant="plain" size="none"`, with its existing layout and typography. Seeking
targets and sortable headings must not acquire hover backgrounds. Only filled variants show a
disabled fill; quiet and text variants dim their content.

Use a shared component where it supplies the element's appearance or behavior. When a caller would
have to cancel most of a component's classes to keep the existing look, the element is not that
component: keep its own markup, as the track grid, catalog rows, album tiles, stat tiles and inline
error messages do. Native `<details>` stays the disclosure control for raw diagnostic payloads.

Sidebar links use the `navigation` button variant. Angular's `RouterLinkActive` sets
`aria-current="page"`, and the shared variant supplies the active appearance.

Text links come in two variants, neither takes a button size, and both rest in the text colors
rather than an accent. `link` is for internal navigation to library entities and settings: it
inherits the surrounding color and turns foreground with an underline on hover. Where an internal
link sits in running text, add `underline decoration-content-muted hover:decoration-current` so it
reads as a link at rest. `external-link` is for links that leave the app: foreground text with a
muted standing underline, taking the action accent only on hover, matching links in imported release
copy.

`HlmProgress` keeps Brain's value, maximum, value text, indeterminate state and direction support.
`HlmProgressSegment` adds semantic outcome colors and widths measured against the parent's maximum.
The progress bar glows by default; `glow="hover"` limits it to hover and `glow="off"` disables it.
Feed playback composes the progress primitives inside the seek button. Circular scan progress keeps
its geometry in app markup; indeterminate work uses `HlmSpinner`.

`HlmSpinner` retains the application's two-arc SVG, requested diameter, stroke and colors, and
ambient rotation. Its per-ring rotation offsets require the scoped animation stylesheet.

Tooltips wait 600ms, wrap long paths, and fit within 24rem and the viewport. `hlmTooltip` labels or
explains a control; when the control's accessible name already contains the tooltip text, it is not
also announced as a description. `hlmOverflowTooltip` reveals truncated text and shows only while
its host, or something inside it, is clipping — measured on hover and focus — so fully visible text
never repeats in a tooltip. Do not put a tooltip on text whose full value is visible elsewhere, or
on roving-focus grid items where every arrow key would open one. Brain 1.5.0 has a pinned
patch in `patches/@spartan-ng__brain@1.5.0.patch`: capture document scroll and dismiss the tooltip,
including pending displays and retained content hover. Its original window listener misses nested
scroll panels. Review and remove this patch when an upstream upgrade fixes that behavior; rerun the
tooltip lifecycle checks before replacing it.

Grid row actions use `tabindex="-1"` so the grid retains its keyboard focus model. Helm preserves
the native static attribute and exposes `[tabindex]` for dynamic values. Disabled buttons receive
`-1`; enabling restores the caller value. Use the directive input for a dynamic tabindex because
Brain's host binding can overwrite `[attr.tabindex]`.

Inputs and textareas accept `aria-describedby`; Brain combines those caller IDs
with descriptions registered by the enclosing Field. The dialog service accepts component classes and `TemplateRef`; a template's `let-dialog`
receives the supplied context and `close(result)` action.

Product components own music data, scan state, recovery actions and navigation. Their fetched
viewport windows and query/range selection remain governed by
[ADR 0004](../../../../../../docs/adr/0004-browse-queries-are-windowed-and-selections-carry-a-query.md).
Route tabs remain links with the history behavior in
[ADR 0006](../../../../../../docs/adr/0006-only-route-changes-are-history-steps.md).

## Add or update a component

When a screen needs a standard control this directory lacks, check whether a Helm family at the
pinned tag covers the use case before building product markup. Upstream ships many families not yet
copied here, and adding one is the default.

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
