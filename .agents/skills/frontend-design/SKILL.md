---
name: frontend-design
description: Build and refine Release Maestro renderer UI to a production-grade standard. Use this skill for any user-facing change in `apps/maestro-renderer` — new pages, components, dialogs, empty/loading/error states, or restyling and polishing existing UI.
---

Release Maestro already has an aesthetic, and it lives in the design system. This skill is about
executing inside that system with care: correct tokens, real hierarchy, complete states, and
accessibility built in — not about inventing a new visual direction.

The user provides frontend requirements: a component, page, dialog, or interface to build or refine.
They may include context about the purpose, the audience, or technical constraints.

## Use the design system and Tailwind

- Start from the existing Release Maestro design system. Reuse its semantic design tokens,
  typography, interaction states, components, and established patterns before introducing a new
  visual treatment. The sources of truth are `apps/maestro-renderer/design-tokens/`,
  `apps/maestro-renderer/src/styles.css`, and the design-system specimen under
  `apps/maestro-renderer/src/app/pages/design-system/`.
- **Tokens are generated.** Edit only the three source files —
  `design-tokens/foundations.json` (raw scales), `design-tokens/semantic.dark.json` (semantic names
  pointing at foundations), and `design-tokens/contrast-pairs.json` (the pairs whose contrast is
  asserted). Everything named `*.generated.*` — `design-tokens/tailwind.generated.json`,
  `src/styles/design-tokens.generated.css`, `src/app/shared/design-tokens.generated.ts`, and the
  electron copy — is written by `apps/maestro-renderer/tools/design-tokens.cjs`. Regenerate with `make design-tokens`; the renderer's build, lint, and test targets already depend on `design-tokens-check`, so a stale or
  contrast-failing token set fails those runs.
- Use Tailwind utility classes by default, including the project's configured semantic tokens,
  variants, and arbitrary values when needed.
- Do not add a custom CSS class when Tailwind can express the result. Custom CSS is a last resort for
  behavior that genuinely cannot be expressed with Tailwind and is expected to be rare. Keep any
  justified exception minimal and scoped.
- If the system is genuinely missing something the design needs, extend the system — add or adjust a
  token and use it — rather than hardcoding a one-off value in a component. Say so when you do.

## Write class lists as `descriptor | utilities`

A long utility list tells you what an element looks like and nothing about what it _is_. So an
element that marks a landmark in the markup carries a **semantic descriptor**: an ordinary
CSS-style name, then a `|`, then the styling classes.

```html
<div class="feed-entry | flex items-center gap-3 p-4">
    <button class="track-play-btn | grid size-6 place-items-center rounded-sm"></button>
</div>
```

The descriptor is annotation. Nothing styles it and nothing should: it exists so the template can be
read and grepped. One per list at most, standing alone it keeps its pipe (`class="favicon |"`), and
inside `[ngClass]` it goes in the object _key_:
`[ngClass]="{ 'dropzone-active | border-border-focus': isDragging() }"`.

**Whether an element earns a name is the judgement call, and nothing checks it for you.** Landmarks
do — a feed entry, a play button, a drop zone. Wrappers, spacers and pure layout elements do not;
with no descriptor there is no pipe either, and the whole list is styling.

Layer discipline is unchecked too: product code consumes **semantic** tokens
(`bg-background-surface`, `text-content-muted`). Foundation tokens belong to token infrastructure,
to shared primitives where there is a stated reason, and to the design-system specimen.

## Build accessibility in

Accessibility is part of the implementation contract, not a later audit. Every UI change must:

- Use semantic HTML and native controls wherever possible.
- Support complete keyboard operation without requiring a pointer or hover.
- Keep focus order logical, manage focus deliberately when UI state changes, and preserve a clearly
  visible focus indicator.
- Give controls, fields, regions, and icon-only actions correct labels and accessible names.
- Use ARIA only when native semantics are insufficient, and keep ARIA roles, properties, and states
  accurate as the interface changes.
- Use design-system foreground/background pairs with readable contrast, and never use color alone to
  convey meaning or state.
- Behave responsively across supported viewport sizes without hiding required functionality or
  creating pointer-only alternatives.
- Avoid interaction patterns that depend only on a pointer, hover, color, animation, or visual
  position. Respect reduced-motion behavior where motion is present.

Verify relevant behavior with user-visible roles, accessible names, labels, keyboard interactions,
visible focus, and responsive states. Follow `docs/testing.md` for test conventions.

## Before coding

Understand the context before opening an editor:

- **Purpose**: What is the user trying to accomplish here, and what is the one thing this screen has
  to make obvious?
- **Prior art**: Which existing page or component already solves a similar problem? Match it. Two
  screens that do similar work should not look or behave like they came from different apps.
- **States**: What does this look like while loading, when empty, when it fails, when the data is
  long or unusually short, and when an operation is in progress?
- **Constraints**: Framework and platform requirements, performance, and the accessibility contract
  above.

Then implement working code that is production-grade, responsive, consistent with the rest of the
app, and complete across all the states you identified.

## Craft inside the system

The design system settles color, type, radius, shadow, and motion. The quality of the result comes
from how you use them.

- **Hierarchy**: Establish a clear primary action, a clear reading order, and obvious grouping. Use
  the type scale and weight tokens to separate levels instead of inventing sizes. One primary action
  per view; everything else is secondary or quiet.
- **Composition and spacing**: Use the spacing scale. Keep rhythm consistent — related things sit
  close, unrelated things get real separation. Alignment should be deliberate, not incidental.
  Let the layout breathe rather than filling every pixel.
- **Interaction states**: Hover, focus-visible, active, disabled, selected, and busy are part of the
  component, not extras. Use the system's interaction states so a control behaves the same way it
  does everywhere else in the app.
- **Motion**: Use the `motion` duration and easing tokens. Motion should explain a change — what
  appeared, what moved, what is loading — and stay short. Global reduced-motion handling exists in
  `styles.css`; anything beyond a simple transition still needs to degrade sensibly.
- **Copy**: Labels, empty states, and error messages are design. Write them in the project's domain
  language (see `docs/agents/domain.md` and `CONTEXT-MAP.md`), be specific about what happened, and
  say what the user can do next.
- **Details**: Truncation and wrapping for long values, sensible tab order, correct cursor and
  pointer affordances, no layout shift when content loads. These are what separate a finished screen
  from a roughed-in one.

## Avoid

- Introducing fonts, palettes, gradients, one-off shadows, or bespoke radii outside the tokens.
- Decorative treatments the system does not use: textures, glassmorphism, noise overlays, custom
  cursors, parallax, or ornamental scroll effects.
- Assuming a light theme. The token set is dark-only; use semantic tokens rather than literal colors
  so the app stays theme-correct.
- Reaching for a third-party UI or animation library when the design system and Tailwind cover it.
- Building a screen that only handles the happy path.
