---
name: principle-foundational-thinking
description: 'Apply before writing logic: choosing core types and data structures, sequencing prerequisite work, asking what concurrent actors share. Get the data structures right so downstream code becomes obvious.'
---

# Foundational thinking

**Structural decisions** protect option value. **Code-level decisions** protect simplicity. Over-engineering is often a premature decision that closes doors. The right foundational data structure keeps doors open.

**Data structures first.** Get the data shape right before writing logic. The right shape makes downstream code obvious. Define core types early, trace every access pattern, and choose structures that match the dominant paths. A data-structure change late is a rewrite. Early, it is often a one-line diff.

At code level, DRY the structure, not every line. Types and data models should converge. Three similar statements still beat a premature abstraction. Prefer explicit over clever. Test behavior and edge cases, not line counts.

**Concurrency corollary.** Before sharing state between actors, ask "what happens if another actor modifies this concurrently?" If not "nothing", isolate.

**Enabling work first.** Identify what later steps depend on, then establish it before building those steps. A shared model, an ownership boundary, or a feedback loop can make later work simpler. Choose foundations for the current requirement and leave speculative ones for later. Keep each increment small and coherent.

Each increment should land a coherent abstraction or deepen one that exists. Do not spread a new capability across callers as special-case coordination.

Remove obsolete code before adding the foundations that replace it.
