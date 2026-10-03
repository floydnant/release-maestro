# Angular UI libraries

Research for [MAE-166](https://linear.app/floyd-haremsa/issue/MAE-166/look-into-proper-ui-libraries-for-angular-stop-custom-building), checked 2026-10-03.

This note records the library evaluation and the selected implementation for two dependent changes.
The foundation adds shared components and a specimen; the migration switches existing product UI to
those components.

## Recommendation

Spartan UI is the strongest starting point for the requested shadcn-style workflow. It supplies finished Angular components with shared styling, copies the presentation code into the repository, and keeps most interaction behavior in an npm package. That lets Release Maestro change component markup, variants and spacing without maintaining every dialog, select and keyboard interaction itself. Its official installation supports both Angular CLI and Nx. See [installation](https://www.spartan.ng/documentation/installation).

Brain's declared Angular/CDK and Tailwind ranges fit the repository. Helm's generated dependencies
need checking. Compilation, token integration and Electron behavior require verification in the
implementation changes; the compatibility ranges alone do not establish them.

## Selected implementation

Release Maestro uses the real `@spartan-ng/brain` 1.5.0 runtime and editable Helm source under
[shared/ui](../../apps/maestro-renderer/src/app/shared/ui/). Canonical
`@spartan-ng/helm/<family>` imports resolve to those local files through the root TypeScript alias.
The local component defaults map directly to Release Maestro's generated semantic tokens. Shared
state and animation rules live in
[styles/spartan.css](../../apps/maestro-renderer/src/styles/spartan.css).

This setup does not install the Spartan CLI or import its global Tailwind preset. It preserves the
existing ng-icons version and uses only the dependencies needed by the copied components. The
component provenance and license notices live beside the source; follow
[shared UI maintenance](../../apps/maestro-renderer/src/app/shared/ui/README.md) when adding or
updating a family.

Standard product controls use shared UI. Music data, scan state, windowed grids, compressed
query/range selection and RouterLink/history behavior remain application responsibilities. The
foundation change introduces components, token adaptation and the development specimen without
migrating product screens. Its dependent change migrates the existing controls across the renderer.

## Catalog breadth

The current official indexes list 63 distinct [Spartan component families](https://www.spartan.ng/components), 64 [shadcn component families](https://ui.shadcn.com/docs/components) and 53 [ZardUI component families](https://zardui.com/docs/components). These counts deduplicate component URL names and exclude separate forms, utilities and block catalogs. A family listed under multiple underlying implementations counts once. Counts describe documented coverage, not implementation maturity, available variants or integration effort.

Spartan's present catalog covers the common controls needed to compose this product. ZardUI's catalog substantially overlaps it; choosing ZardUI would not expand the component family catalog. Shadcn also supplies [larger composed blocks](https://ui.shadcn.com/blocks), such as dashboard and sidebar layouts. Ready-made screen compositions are a separate question from basic control coverage.

## Alternatives

| Option             | What we would own                                                                            | Fit for this request                                                                                                |
| ------------------ | -------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| Spartan UI         | Local Tailwind-styled Helm components; packaged Brain/CDK behavior                           | First choice. Broad component coverage, editable presentation and stable releases.                                  |
| ZardUI             | Local Angular component and interaction code, plus CDK and selected third-party dependencies | Closest runner-up. Shadcn-inspired components and Tailwind 4 theming, with more copied behavior to maintain.        |
| Angular Primitives | Local generated styled components; packaged `ng-primitives` behavior                         | Worth a comparison because it is already installed. More work to build a complete, consistent component collection. |

ZardUI's [registry](https://zardui.com/docs/registry) distributes editable Angular source, including services and utilities. Its [theming](https://zardui.com/docs/theming) uses CSS variables mapped to Tailwind utilities. It covers dialogs, context menus, comboboxes, forms and other common controls. The [published registry](https://zardui.com/r/registry.json) reports `1.0.0-beta.123`; the [latest GitHub release](https://github.com/zard-ui/zardui/releases/tag/v1.0.0-beta.123) was published September 26. The separately published [CLI](https://registry.npmjs.org/zard-cli/latest) is `1.0.0-beta.117`. It is [MIT licensed](https://github.com/zard-ui/zardui/blob/master/LICENSE.md), and its [support policy](https://zardui.com/docs/version-support) explicitly includes Angular 22.

ZardUI's [customization-preserving update command](https://zardui.com/docs/cli#update) is still planned. Copied fixes therefore need manual review. Some behavior remains external, such as the [Sonner component's `ngx-sonner` dependency](https://zardui.com/r/sonner.json). Its [dialog E2E test](https://github.com/zard-ui/zardui/blob/master/apps/web-e2e/src/components/dialog.spec.ts) checks Escape dismissal and runs axe, but disables button-name, color-contrast, label and scrollable-region-focusable checks. Test presence alone does not establish full accessibility coverage.

In practice, ZardUI's [CLI](https://zardui.com/docs/cli) adds selected component source and its dependencies to the application. We import those local components into standalone Angular components. For example, its [button](https://zardui.com/docs/components/button) supports native `<button z-button>` usage with shared size and appearance variants. Changes to those local defaults apply wherever that component is used. Changing theme variables or local component variants can match Release Maestro's existing design system.

That supports custom product compositions without recreating their standard controls:

| Product composition | Library components to reuse                       | Application work                                    |
| ------------------- | ------------------------------------------------- | --------------------------------------------------- |
| Album actions       | Card, badge, button, context menu and tooltip     | Artwork, album data and music-specific actions      |
| Browse filters      | Input, combobox, popover, select and toggle group | Browse query, available filter values and URL state |
| Import status       | Progress, badge, alert and collapsible            | Scan/import state, counts and recovery actions      |
| Settings dialog     | Dialog, field, input, switch and buttons          | Settings values, validation and save behavior       |

These are proposed compositions. Their presence in a library does not establish suitability for every product interaction. ZardUI's [Table](https://zardui.com/docs/components/table), for example, styles native table elements and exposes appearance/density variants. Large-library windowing, sorting queries and query/range selection still belong to the application. The same distinction applies when evaluating Spartan's Data Table guide.

Angular Primitives already offers styled, editable recipes. The installed `0.131.0` [generator schema](https://github.com/ng-primitives/ng-primitives/blob/v0.131.0/packages/ng-primitives/schematics/ng-generate/schema.json) exposes 32 families, including dialog, menu, select, combobox and toast. Its [published manifest](https://registry.npmjs.org/ng-primitives/0.131.0) supports Angular/CDK 21 and 22 under Apache-2.0. The [select documentation](https://angularprimitives.com/primitives/select/) explains component generation.

Those recipes use inline CSS and `--ngp-*` variables, with fixed dimensions and radii. Their [dialog template](https://github.com/ng-primitives/ng-primitives/tree/v0.131.0/packages/ng-primitives/schematics/ng-generate/templates/dialog) has a required header and projected description content. The [combobox template](https://github.com/ng-primitives/ng-primitives/tree/v0.131.0/packages/ng-primitives/schematics/ng-generate/templates/combobox) supplies string options and local filtering. The generator lacks cards, badges, skeletons, sidebar and command components. Helm provides more complete composition for these needs. My assessment is that Primitives reduces interaction work but leaves more component assembly and styling to this project. Its [styling guide](https://angularprimitives.com/getting-started/styling/) makes that trade-off explicit.

[Angular Aria](https://angular.dev/guide/aria/overview) and CDK supply behavior while the application supplies markup and styling. That would leave the work this task aims to reduce. Current [PrimeNG](https://primeng.dev/theming/unstyled) offers unstyled mode and PassThrough customization, but PrimeNG 22 and later moved to compiled packages under PrimeUI licensing in July 2026. [The source is private](https://primeui.dev/security), while older MIT versions retain their license. Community licensing also requires eligibility and renewal. See the [official transition](https://primeui.dev/nextchapter). I would exclude it for this source-ownership requirement.

## What the repository needs

At the initial inspection on 2026-10-03, the [root manifest](../../package.json) pinned Angular/CDK
`22.2.0`, Tailwind `4.3.3`, ng-primitives `0.131.0` and ng-icons `36.1.0`. Renderer searches found no
imports of ng-primitives, CDK or Floating UI. Reuse was mainly the button, input, badge and panel
utilities in [styles.css](../../apps/maestro-renderer/src/styles.css).

The [Tailwind configuration](../../apps/maestro-renderer/tailwind.config.js) replaces spacing, radius, opacity and shadow scales with generated tokens. A copied library class can therefore have a different value or emit no CSS. Renderer guidance requires semantic tokens. Lint enforces enumerable class lists, `app-*` component selectors and `appCamelCase` directive selectors. CVA/class-merging helpers and library selectors need deliberate integration with [renderer lint](../../apps/maestro-renderer/eslint.config.mjs) and [root lint](../../eslint.config.mjs).

Use the existing [token sources](../../apps/maestro-renderer/design-tokens/) for colors, typography, density, focus, hover, disabled and motion states. Adapt the shared components once, then reuse their approved variants. This is how the library can reduce inconsistency while retaining Release Maestro's product language.

## What Spartan actually gives us

Spartan separates Brain and Helm. `@spartan-ng/brain` supplies unstyled behavior. The CLI copies Helm directives and components into the application's codebase. The `@spartan-ng/helm/...` imports shown in examples refer to that local code. Editing Helm is the intended customization path. Brain stays a package dependency; changing its internal behavior is a separate maintenance decision. See [installation](https://www.spartan.ng/documentation/installation) and the [update guide](https://www.spartan.ng/documentation/update-guide).

Helm contains Angular code as well as styles. For example, the [context-menu trigger](https://github.com/spartan-ng/spartan/blob/v1.5.0/libs/helm/context-menu/src/lib/hlm-context-menu-trigger.ts) wraps `CdkContextMenuTrigger`, and the [dropdown menu](https://github.com/spartan-ng/spartan/blob/v1.5.0/libs/helm/dropdown-menu/src/lib/hlm-dropdown-menu.ts) wraps `CdkMenu`. This is source ownership of the presentation and composition layer, with packaged behavior beneath it.

Theming uses CSS variables and Tailwind utilities. Semantic color pairs include background/foreground, primary, muted, accent, destructive and popover. Light and dark modes have separate variable values. The CLI offers six starting styles, including Nova, Vega and Lyra. Colors, radius and component source remain editable after choosing one. See [theming](https://www.spartan.ng/documentation/theming) and [styles](https://www.spartan.ng/documentation/styles).

For this project, map those roles onto the existing design tokens and tune a shared set of component defaults. Copying the stock theme unchanged would introduce a second design system. Centralize the few necessary changes in the local Helm files, then use the same components across features.

## Component coverage

| Need                   | Supplied components and limits                                                                                                                                                                                                                                                                                                                            |
| ---------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Dialogs                | Dialog and Alert Dialog, with declarative triggers and programmatic opening. The [Brain service](https://github.com/spartan-ng/spartan/blob/v1.5.0/libs/brain/dialog/src/lib/brn-dialog.service.ts) delegates overlays and focus options to Angular CDK. See [Dialog](https://www.spartan.ng/components/dialog).                                          |
| Menus                  | Dropdown Menu, Context Menu, Menubar and Navigation Menu. The [context-menu example](https://www.spartan.ng/components/context-menu) includes nested menus, disabled items, checkboxes and radios. See [Dropdown Menu](https://www.spartan.ng/components/dropdown-menu).                                                                                  |
| Selects and comboboxes | Select supports single and multiple values. Combobox examples include filtering, object values, chips and async search. The application still supplies data fetching and its loading/error behavior. See [Select](https://www.spartan.ng/components/select) and [Combobox](https://www.spartan.ng/components/combobox).                                   |
| Tooltips               | Tooltip with configurable behavior and groups that share a delay window. See [Tooltip](https://www.spartan.ng/components/tooltip).                                                                                                                                                                                                                        |
| Tabs                   | Tabs for switching associated content panels. Use them where that interaction is appropriate; do not assume they replace route navigation. See [Tabs](https://www.spartan.ng/components/tabs).                                                                                                                                                            |
| Toasts                 | Sonner toaster and a `toast` API with success, warning, error, promise and action examples. Current code imports behavior from `@spartan-ng/brain/sonner`, not `ngx-sonner`. See [Sonner](https://www.spartan.ng/components/sonner) and [Helm toaster source](https://github.com/spartan-ng/spartan/blob/v1.5.0/libs/helm/sonner/src/lib/hlm-toaster.ts). |
| Tables                 | Table directives supply presentation. Data Table is explicitly a guide to composing a table with TanStack, not a ready-made grid component. It does not establish support for Release Maestro's large windowed library or query selection model. See [Data Table](https://www.spartan.ng/components/data-table).                                          |

The CLI also copies dependent components. For example, Context Menu requires Dropdown Menu, and Combobox requires Input Group and Button. See the [component dependency map](https://github.com/spartan-ng/spartan/blob/v1.5.0/libs/cli/src/generators/ui/primitive-deps.ts).

## Version compatibility

The current stable release is 1.5.0, published 2026-09-21. The [published Brain manifest](https://registry.npmjs.org/@spartan-ng/brain/1.5.0) and [tagged source manifest](https://github.com/spartan-ng/spartan/blob/v1.5.0/libs/brain/package.json) agree on these peer ranges.

| Dependency                | Brain 1.5.0 requirement | Release Maestro                                             |
| ------------------------- | ----------------------- | ----------------------------------------------------------- |
| Angular core/common/forms | `>=21.0.0 <23.0.0`      | `22.2.0`, within range                                      |
| Angular CDK               | `>=21.0.0 <23.0.0`      | `22.2.0`, within range                                      |
| Tailwind CSS              | `>=4.0.0`               | `4.3.3`, within range                                       |
| RxJS                      | `>=6.6.0`               | `7.8.2`, also satisfies Helm components requesting `^7.8.0` |
| clsx                      | `>=2.0.0`               | New direct dependency                                       |
| tw-animate-css            | `>=1.0.0`               | New dependency when using the preset                        |
| Luxon                     | `>=3.0.0`, optional     | Needed only if using the Luxon date adapter                 |

Spartan's [support policy](https://www.spartan.ng/documentation/version-support) explicitly lists Angular 21 and 22 and supports the two latest Angular majors. Existing Angular 22 versions do not require a downgrade for Brain 1.5.0.

Helm can add dependencies beyond Brain. The [component manifest](https://github.com/spartan-ng/spartan/blob/v1.5.0/libs/cli/src/generators/ui/supported-ui-libraries.json) requests `class-variance-authority ^0.7.0`, `clsx ^2.1.1`, and, for several components, ng-icons `>=32.0.0 <34.0.0`. The repo's existing ng-icons `36.1.0` falls outside that range. This is a generator-default mismatch; the selected integration adapts the local Helm source to the existing icon API rather than applying those dependency changes verbatim. A compatible ng-icons 33 package supports Angular 22, but downgrading the project's icons would need its own assessment. See the [ng-icons 33.0.0 manifest](https://registry.npmjs.org/@ng-icons/core/33.0.0). The CLI also adds Tailwind Merge and animation CSS. See [dependency generation](https://github.com/spartan-ng/spartan/blob/v1.5.0/libs/cli/src/generators/base/lib/build-dependency-array.ts).

CLI 1.5.0 declares Nx and `@nx/* >=21.0.0` and TypeScript `>=5.0.0 <7.0.0`, but also depends on `@schematics/angular 21.2.14`. Nx 23.2.1 satisfies the declared Nx range. That is not proof that every generator works in this workspace. The selected integration copies tagged source manually, so it does not introduce those generator dependencies. See the [CLI manifest](https://github.com/spartan-ng/spartan/blob/v1.5.0/libs/cli/package.json).

## Accessibility and maintenance

There is evidence behind Spartan's accessibility claims. Its [dialog E2E suite](https://github.com/spartan-ng/spartan/blob/v1.5.0/apps/ui-storybook-e2e/src/integration/dialog/dialog.cy.ts) checks keyboard opening, Escape dismissal, wrapping tab focus, focus restoration and dialog ARIA attributes. Its [combobox suite](https://github.com/spartan-ng/spartan/blob/v1.5.0/apps/ui-storybook-e2e/src/integration/combobox/combobox.cy.ts) runs axe checks before and after opening. Those tests exclude certain Storybook heading/landmark rules. This evidence does not certify the application or every customized composition.

The [1.5.0 release](https://github.com/spartan-ng/spartan/releases/tag/v1.5.0) includes fixes for dialog accessibility, select focus handling and combobox/autocomplete accessibility. That demonstrates active maintenance and gives a reason to use the current stable release. It also means copied components and packaged behavior need an update routine.

Brain and CLI update through the package manager. Customized Helm files require reviewing and applying upstream changes. The automated Helm migration replaces those files and overwrites customizations. Keep a small record of local changes and review the upstream diff on upgrades. See the [update guide](https://www.spartan.ng/documentation/update-guide).

Spartan is [MIT licensed](https://github.com/spartan-ng/spartan/blob/v1.5.0/LICENSE). Retain the copyright and license notice with copied source.

## Integration checks

1. Exercise the shared variants in the design-system specimen, then migrate standard controls across
   the existing renderer, including [browse search](../../apps/maestro-renderer/src/app/shared/components/browse-shell/browse-shell.component.html)
   and [album-sort select](../../apps/maestro-renderer/src/app/shared/components/album-grid/album-sort-bar.component.html).
   Include a dialog and nested menu in the specimen to test focus and overlays.
2. Map semantic colors to existing generated tokens. Inspect radius, spacing, font and shadow utilities too. The [Brain preset](https://github.com/spartan-ng/spartan/blob/v1.5.0/libs/brain/hlm-tailwind-preset.css) defines unprefixed Tailwind colors and radius utilities, supplies a `.dark` variant, and changes CDK backdrop styles globally. Keep it out of this integration and supply only the state/animation rules the local components need.
3. Copied components under renderer `src` are already included in Tailwind source detection. Tailwind classes inside packaged component templates need an explicit `@source` path because `styles.css` uses `source(none)`. Packages shipping compiled CSS can import that CSS. Reconcile copied selectors and classes with repository lint conventions and preserve the signal/OnPush patterns.
4. Verify keyboard navigation, focus restoration, disabled states, validation, dark appearance and nested overlays in Electron. Compare the customized components at the application's normal density, not only in standalone examples.
5. Preserve the table's fetched viewport window and query/range selection required by [ADR 0004](../adr/0004-browse-queries-are-windowed-and-selections-carry-a-query.md). Preserve RouterLink and history behavior in the tab bar under [ADR 0006](../adr/0006-only-route-changes-are-history-steps.md). Reuse standard controls inside these product components.
6. Keep [frontend-design guidance](../../.agents/skills/frontend-design/SKILL.md) aligned with shared
   components as the default. Record copied component versions and local edits so upgrades remain
   reviewable.

The migration is complete when existing standard controls use shared UI and renderer lint, build
and the relevant interaction suites pass. Preserve URL and windowed-grid behavior, and verify
keyboard operation and overlays in Electron. Styling changes belong in shared components rather
than repeated overrides across product screens. Follow [the testing guide](../testing.md) for the
checks appropriate to the implementation.
