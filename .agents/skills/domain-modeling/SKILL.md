---
name: domain-modeling
description: Build and sharpen Release Maestro's domain model. Use when discussing domain terminology, editing a context glossary, or recording an ADR.
---

# Domain Modeling

Actively build and sharpen the project's domain model as you design. This is the _active_ discipline: challenging terms, inventing edge-case scenarios, and writing the glossary and decisions down when they crystallise. Merely reading a glossary is not this skill.

## File structure

Release Maestro has multiple product contexts:

```
/
├── CONTEXT-MAP.md
├── docs/
│   ├── contexts/
│   │   └── <context>/CONTEXT.md
│   └── adr/
```

Start at `CONTEXT-MAP.md`, then edit the relevant glossary under `docs/contexts/`. Add a new glossary lazily only when an area develops vocabulary of its own. ADRs live together in `docs/adr/` and are indexed by context in `docs/adr/README.md`.

## During the session

### Challenge against the glossary

When the user uses a term that conflicts with the relevant glossary, call it out immediately. "Your glossary defines 'cancellation' as X, but you seem to mean Y. Which is it?"

### Sharpen fuzzy language

When the user uses vague or overloaded terms, propose a precise canonical term. "You're saying 'account': do you mean the Customer or the User? Those are different things."

### Discuss concrete scenarios

When domain relationships are being discussed, stress-test them with specific scenarios. Invent scenarios that probe edge cases and force the user to be precise about the boundaries between concepts.

### Cross-reference with code

When the user states how something works, check whether the code agrees. If you find a contradiction, surface it: "Your code cancels entire Orders, but you just said partial cancellation is possible. Which is right?"

### Update the glossary inline

When a term is resolved, update the relevant glossary right there. Use the format in [CONTEXT-FORMAT.md](./CONTEXT-FORMAT.md).

Keep the glossary about domain meaning. A small route, schema field, protocol name, or representative code location is allowed when it makes the meaning operationally unambiguous. Broader design and workflow details belong in code, ADRs, or focused technical documentation.

### Offer ADRs sparingly

Only offer to create an ADR when all three are true:

1. **Hard to reverse**: the cost of changing your mind later is meaningful
2. **Surprising without context**: a future reader will wonder "why did they do it this way?"
3. **The result of a real trade-off**: there were genuine alternatives and you picked one for specific reasons

If any of the three is missing, skip the ADR. Use the format in [ADR-FORMAT.md](./ADR-FORMAT.md).
