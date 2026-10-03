---
name: principle-exhaust-the-design-space
description: 'Apply when facing a novel UI interaction or architectural decision with no precedent in the codebase. Compare distinct designs using the cheapest form that answers the question.'
---

# Exhaust the Design Space

When a novel interaction or architectural decision has no established precedent, compare distinct
alternatives before implementation. Stop exploring once the choice has enough evidence.

**The rule.** Start with two distinct designs using sketches, small prototypes, or concrete
interfaces. Use the cheapest form that answers the question. Add a third if the tradeoff remains
unclear, then stop unless new evidence reveals a missing alternative. Compare the designs side by
side and implement the smallest robust choice. A second flavor of the first shape does not count.

**When it applies:**

- Novel UI interactions (no prior art in the codebase)
- Architectural choices with multiple viable approaches
- Product design decisions where user experience depends on feel, not logic

**When it doesn't:**

- Mechanical implementation where the pattern is established
- Bug fixes or refactors with a clear target state
- Changes where constraints dictate a single viable approach
