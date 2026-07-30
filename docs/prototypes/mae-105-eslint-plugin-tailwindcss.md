# MAE-105 — class validation with `eslint-plugin-tailwindcss`

**Status:** prototype. One of three isolated experiments under MAE-100. Not a decision, not an
architecture proposal. Delete or absorb once MAE-100 picks a winner.

## Question

Can `eslint-plugin-tailwindcss` — configured, plus the smallest possible extension — reject a class
name that does not exist, across the class surfaces this renderer actually uses?

The motivating failure: `class="type-code-sl"` type-checks, builds, renders, and silently produces
no CSS. Nothing in the repository catches it today.

## What was built

Three moving parts, in increasing order of intrusiveness:

1. **Turned the upstream rule on.** `tailwindcss/no-custom-classname` was already installed and
   explicitly set to `off` in [eslint.config.mjs](/eslint.config.mjs).
2. **Told it where the non-Tailwind classes live.** `settings.tailwindcss.cssFiles` points at
   `styles.css`, the generated token CSS, and component CSS, so authored selectors (`.btn`,
   `.badge`, `.title-bar`) are recognised without a hand-maintained allowlist. A three-entry
   `whitelist` covers the utilities registered through `addUtilities()` in
   [tailwind.config.js](/apps/maestro-renderer/tailwind.config.js), which Tailwind cannot enumerate.
3. **Wrapped it for Angular.**
   [tools/eslint/tailwindcss-angular/no-custom-classname.cjs](/tools/eslint/tailwindcss-angular/no-custom-classname.cjs)
   delegates to the upstream rule and adds only two things: the `descriptor | utilities` convention,
   and dynamic class surfaces. It extracts class lists from the Angular AST and feeds them back into
   the _upstream_ rule as synthetic `class` attributes, so validation logic is never reimplemented.
   The wrapper is ~180 lines, most of it AST extraction.

Upstream already visits `TextAttribute`, so static `class="…"` in Angular templates worked out of
the box. `@angular-eslint`'s inline-template processor means `template:` strings in `.ts` files are
covered for free.

## Acceptance corpus

Run with `make prototype-classname-test`. Source:
[no-custom-classname.node-test.cjs](/tools/eslint/tailwindcss-angular/no-custom-classname.node-test.cjs).

| #   | Case                                                     | Result               |
| --- | -------------------------------------------------------- | -------------------- |
| C1  | core Tailwind utility accepted                           | pass                 |
| C2  | unknown static class rejected (`type-code-sl`)           | pass                 |
| C3  | generated design-token utility accepted                  | pass                 |
| C4  | authored global class accepted (`btn`, `badge`, `panel`) | pass                 |
| C5  | component-scoped CSS class accepted (`title-bar`)        | pass                 |
| C6  | descriptor before the pipe exempt                        | pass                 |
| C7  | descriptor-only class list (`favicon \|`)                | pass                 |
| C8  | arbitrary values accepted                                | pass                 |
| C9  | built-in and repo-defined variants accepted              | pass                 |
| C10 | `addUtilities()` utilities accepted                      | pass (via whitelist) |
| C11 | valid `[class.x]` binding accepted                       | pass                 |
| C12 | valid `[ngClass]` object keys accepted                   | pass                 |
| C13 | valid `[class]` literal accepted                         | pass                 |
| C14 | valid `routerLinkActive` accepted                        | pass                 |
| C15 | `[ngClass]="'type-' + token"` produces no false positive | pass                 |
| C16 | complete literal in a concatenation validated            | pass                 |
| C17 | non-class attributes ignored                             | pass                 |
| C18 | conditional binding branches validated                   | pass                 |
| C19 | array binding validated                                  | pass                 |
| C20 | class list inside `@if` control flow validated           | pass                 |
| C21 | utility removed from the theme rejected (`py-14`)        | pass                 |
| C22 | unknown class after the pipe rejected                    | pass                 |
| C23 | unknown `[class.x]` rejected                             | pass                 |
| C24 | unknown `[ngClass]` key rejected                         | pass                 |
| C25 | unknown `[class]` literal rejected                       | pass                 |
| C26 | unknown `routerLinkActive` rejected                      | pass                 |
| C27 | unknown complete literal in a concatenation rejected     | pass                 |
| C28 | valid `host: { class: … }` metadata accepted             | pass                 |
| C29 | unrelated `{ class: … }` object not treated as classes   | pass                 |
| C30 | unknown host-metadata class rejected                     | pass                 |
| C31 | unknown `[attr.class]` literal rejected                  | pass                 |
| C32 | `@HostBinding('class.foo')`                              | **unsupported**      |
| C33 | `el.classList.add('foo')` and other imperative mutation  | **unsupported**      |

Additional surfaces probed by hand against the real renderer, then removed:

| Surface                                           | Result                                                                |
| ------------------------------------------------- | --------------------------------------------------------------------- |
| inline `template:` in a `.ts` component           | covered (via `@angular-eslint` inline-template processor)             |
| class defined only in an inline `styles:` literal | **false positive** — `cssFiles` globs files, not TS strings           |
| `@apply` inside `.css`                            | **unsupported** — `.css` is not linted and the plugin has no CSS rule |
| class name assembled entirely at runtime          | **unsupported** by design; stays silent rather than guessing          |

## What it found in the real repository

Enabling the rule on the untouched renderer produced **18 errors in 8 files, no false-positive
flood**. Two distinct populations:

**True positives — classes that exist in the source and emit no CSS.** Verified independently by
asking Tailwind directly (`generateRules`) — all five produce zero rules, because
`tailwind.config.js` _replaces_ `theme.spacing` and `theme.opacity` with design tokens instead of
extending them.

| Class        | Site                                    | Nearest valid value                    |
| ------------ | --------------------------------------- | -------------------------------------- |
| `py-14`      | folder-list dropzone                    | spacing scale stops at `12`, then `16` |
| `opacity-80` | folder-list "tracks are marked missing" | `opacity-70`                           |
| `max-h-72`   | debug page, twice                       | `max-h-[18rem]`                        |
| `min-h-36`   | debug page textarea                     | `min-h-[9rem]`                         |
| `max-h-44`   | debug page                              | `max-h-[11rem]`                        |

This branch **removes** them rather than substituting values: they render as nothing today, so
deletion is behaviour-preserving. Restoring the lost intent is a design decision, not a lint fix —
the table above is the hand-off.

**Convention gaps — semantic descriptors not yet migrated to the pipe.** `app-shell`,
`settings-item`, `track-control`, `track-seeker`, `favicon`, `progress-bg`, `mosaic-cell`,
`mosaic-tile`, `mosaic-tile--enter`, `mosaic-tile--leave`, `mosaic-veil`. All were moved to the left
of a `|`, which is what MAE-104 already asks for. None of them had CSS anywhere except the
`mosaic-*` family, which is styled from an inline `styles:` literal.

## Cost

Measured on this machine, renderer only (`apps/maestro-renderer/src/**/*.{ts,html}`, 3 runs each):

| Run                                 | Time                  |
| ----------------------------------- | --------------------- |
| `npx eslint` with the rule off      | 4.47s / 3.51s / 3.58s |
| `npx eslint` with the rule on       | 3.89s / 3.73s / 3.75s |
| `npx nx lint maestro-renderer` cold | 7.9s                  |
| `npx nx lint maestro-renderer` warm | 5.2s                  |

The rule's own cost is inside the measurement noise. The Tailwind context is built once per lint
process; `cssFiles` are re-read at most every `cssFilesRefreshRate` (5s default).

## Honest assessment

**What this approach buys**

- Editor feedback for free. The rule is in the flat config, so VS Code underlines the bad class as
  you type — no separate scan, no separate command, no CI-only failure.
- Validation logic is not ours. Tailwind's own `generateRules` decides what exists, through
  `tailwind-api-utils`. Arbitrary values, variants, prefixes, and plugin-generated utilities are
  handled by the plugin, not by a regex we maintain.
- No duplicate allowlist. Everything the rule accepts comes from either the Tailwind config or an
  actual CSS selector. The three whitelist entries are the only hand-maintained names, and they exist
  because `addUtilities()` output is not enumerable.
- Small blast radius. Config change plus one wrapper file; the upstream rule remains the engine.

**What it costs**

- **The pipe convention stops being optional.** The rule cannot distinguish a semantic descriptor
  from a typo, so every descriptor must sit left of a `|` — including descriptor-only lists, which
  become `class="favicon |"`. That trailing pipe is ugly and has to be accepted as a rule of the
  house before this approach can ship.
- **`cssFiles` leaks scope.** A class defined in one component's CSS is accepted in every other
  component's template, even though view encapsulation means it will not apply there. The rule
  validates _existence somewhere_, not _reachability here_.
- **Inline `styles:` are invisible.** `cssFiles` globs files; classes defined in a component's
  `styles:` template literal are false positives. Either those components move their CSS to a file,
  or their classes become descriptors, or the wrapper grows a TS-string CSS scan — the third option
  is where "minimal extension" stops being minimal.
- **Imperative class names are out of reach.** `@HostBinding('class.x')`, `classList.add`,
  `renderer.addClass`, and fully computed strings are silently unchecked. That silence is
  deliberate — false positives on dynamic code would be worse — but it is a coverage hole, not a
  pass.
- **Upstream dependency risk.** The wrapper reaches into
  `eslint-plugin-tailwindcss/lib/rules/no-custom-classname`, a deep import with no stability
  guarantee. The plugin is also on 3.18.3 with a pending 4.x bump (PR #100), and 4.x targets Tailwind
  4 — the wrapper would need re-validating on that upgrade.
- **CSS is not covered at all.** A typo in `@apply` in `styles.css` still slips through. Whatever
  MAE-100 chooses, that gap needs a separate answer.

## Reproduce

```sh
make prototype-classname-test          # acceptance corpus
npx nx lint maestro-renderer           # rule running for real
```

## Caveat on provenance

This session had no access to Linear (no MCP, web fetch is auth-walled), so MAE-100's literal shared
corpus could not be read. The corpus above was reconstructed from the invariants recorded in the
prototype hand-off plus the class surfaces that actually occur in this renderer. Case _numbering_
will not line up with MAE-100's; the cases themselves should be checked against it before the
comparison is scored.
