---
name: principle-exhaust-the-design-space
description: 'Apply when facing a novel UI interaction or architectural decision with no precedent in the codebase. Compare distinct designs using the cheapest form that answers the question.'
---

# Exhaust the Design Space

When a novel interaction or architectural decision has no established precedent, explore several concrete alternatives before implementation. Building the wrong thing costs more than exploring three options.

**The rule.** When the right answer is not obvious, compare at least two distinct designs using sketches, small prototypes, or concrete interfaces. Use the cheapest form that answers the question. Compare them side by side. Once the choice is clear, stop exploring and implement the smallest robust version. Design it twice is this rule by another name. A second flavor of the first shape does not count.

**When it applies:**

- Novel UI interactions (no prior art in the codebase)
- Architectural choices with multiple viable approaches
- Product design decisions where user experience depends on feel, not logic

**When it doesn't:**

- Mechanical implementation where the pattern is established
- Bug fixes or refactors with a clear target state
- Changes where constraints dictate a single viable approach
